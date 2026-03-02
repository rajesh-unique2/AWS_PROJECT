from flask import Flask, request, jsonify, session, send_from_directory
from flask_pymongo import PyMongo
from flask_bcrypt import Bcrypt
from flask_cors import CORS
from bson import ObjectId
from bson.errors import InvalidId
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from datetime import datetime
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os
import json
import certifi
from types import SimpleNamespace
from config import Config

app = Flask(__name__)
app.config.from_object(Config)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=False,
)

def create_mongo_client():
    primary_client = PyMongo(app, tlsCAFile=certifi.where(), serverSelectionTimeoutMS=5000)
    fallback_enabled = os.getenv("ALLOW_MOCK_DB_FALLBACK", "1") == "1"

    try:
        primary_client.cx.admin.command("ping")
        app.config["DB_MODE"] = "mongodb"
        return primary_client
    except Exception as db_error:
        if not fallback_enabled:
            raise

        import mongomock

        mock_db_name = os.getenv("MOCK_DB_NAME", "south_indian_jewelry")
        mock_client = mongomock.MongoClient()
        app.config["DB_MODE"] = "mock"
        app.logger.warning(
            "MongoDB unavailable (%s). Using in-memory mock database '%s'.",
            db_error,
            mock_db_name,
        )
        return SimpleNamespace(db=mock_client[mock_db_name], cx=mock_client)


mongo = create_mongo_client()
bcrypt = Bcrypt(app)

default_cors_origins = [
    r"http://localhost:\d+",
    r"https://localhost:\d+",
    r"http://127\.0\.0\.1:\d+",
    r"https://127\.0\.0\.1:\d+",
    r"http://192\.168\.\d+\.\d+:\d+",
    r"https://192\.168\.\d+\.\d+:\d+",
    r"http://10\.\d+\.\d+\.\d+:\d+",
    r"https://10\.\d+\.\d+\.\d+:\d+",
    r"http://172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+:\d+",
    r"https://172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+:\d+",
    r"http://[a-zA-Z0-9\-\.]+:\d+",
    r"https://[a-zA-Z0-9\-\.]+:\d+",
    "null",
]

frontend_origin_env = os.getenv("FRONTEND_ORIGIN", "").strip()
frontend_origins_env = os.getenv("FRONTEND_ORIGINS", "").strip()
configured_origins = [
    origin.strip()
    for origin in [frontend_origin_env, *frontend_origins_env.split(",")]
    if origin.strip()
]

CORS(
    app,
    supports_credentials=True,
    origins=[*default_cors_origins, *configured_origins],
)

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))


@app.route("/", methods=["GET"])
def serve_frontend_index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/login", methods=["GET"])
def serve_login_page():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/signup", methods=["GET"])
def serve_signup_page():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/tracking", methods=["GET"])
def serve_tracking_page():
    return send_from_directory(FRONTEND_DIR, "tracking.html")


@app.route("/account", methods=["GET"])
def serve_account_page():
    return send_from_directory(FRONTEND_DIR, "account.html")


@app.route("/account.html", methods=["GET"])
def serve_account_page_html():
    return send_from_directory(FRONTEND_DIR, "account.html")


@app.route("/tracking.html", methods=["GET"])
def serve_tracking_page_html():
    return send_from_directory(FRONTEND_DIR, "tracking.html")


@app.route("/css/<path:filename>", methods=["GET"])
def serve_frontend_css(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, "css"), filename)


@app.route("/js/<path:filename>", methods=["GET"])
def serve_frontend_js(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, "js"), filename)

# ─────────────────────────────────────────────
# Helper
# ─────────────────────────────────────────────
def serialize(obj):
    """Recursively convert ObjectId / datetime to str."""
    if isinstance(obj, list):
        return [serialize(i) for i in obj]
    if isinstance(obj, dict):
        return {k: serialize(v) for k, v in obj.items()}
    if isinstance(obj, ObjectId):
        return str(obj)
    if isinstance(obj, datetime):
        return obj.isoformat()
    return obj


def _get_token_serializer():
    return URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="south-indian-jewelry-auth")


def _send_order_notification_email(order, recipient_email):
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "").strip()

    if not recipient_email:
        return {"sent": False, "reason": "No recipient email provided"}
    if not smtp_user or not smtp_password:
        return {"sent": False, "reason": "SMTP is not configured in backend/.env"}

    subject = f"New Order Placed: {order.get('tracking_id', '')}"
    lines = [
        "A new order has been placed.",
        "",
        f"Order ID: {order.get('order_id')}",
        f"Tracking ID: {order.get('tracking_id')}",
        f"Customer: {order.get('user_name', '')}",
        f"Email: {order.get('user_email', '')}",
        f"Payment: {order.get('payment_method', '')}",
        f"Total: ₹{order.get('total_amount', 0)}",
        f"Status: {order.get('status', '')}",
        "",
        "Items:",
    ]

    for item in order.get("items", []):
        lines.append(f"- {item.get('name', '')} x {item.get('quantity', 0)}")

    message = MIMEMultipart()
    message["From"] = smtp_user
    message["To"] = recipient_email
    message["Subject"] = subject
    message.attach(MIMEText("\n".join(lines), "plain", "utf-8"))

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, [recipient_email], message.as_string())
        return {"sent": True, "reason": "Email sent"}
    except Exception as email_error:
        print(f"⚠️ Order email failed: {email_error}")
        return {"sent": False, "reason": str(email_error)}


def create_auth_token(user_id, user_name, user_role):
    serializer = _get_token_serializer()
    return serializer.dumps(
        {
            "user_id": str(user_id),
            "user_name": user_name,
            "user_role": user_role,
        }
    )


def get_auth_identity():
    if "user_id" in session:
        return {
            "user_id": session.get("user_id"),
            "user_name": session.get("user_name", ""),
            "user_role": session.get("user_role", "customer"),
        }

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None

    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        return None

    serializer = _get_token_serializer()
    try:
        payload = serializer.loads(token, max_age=60 * 60 * 24 * 7)
        return {
            "user_id": payload.get("user_id"),
            "user_name": payload.get("user_name", ""),
            "user_role": payload.get("user_role", "customer"),
        }
    except (BadSignature, SignatureExpired):
        return None


def require_auth():
    identity = get_auth_identity()
    if not identity or not identity.get("user_id"):
        return None, (jsonify({"error": "Not authenticated"}), 401)
    return identity, None


def require_admin():
    identity, error_response = require_auth()
    if error_response:
        return None, error_response
    if identity.get("user_role") != "admin":
        return None, (jsonify({"error": "Unauthorized"}), 403)
    return identity, None


# ─────────────────────────────────────────────
# AUTH ROUTES
# ─────────────────────────────────────────────

@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not all([name, email, password]):
        return jsonify({"error": "All fields are required"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    if mongo.db.users.find_one({"email": email}):
        return jsonify({"error": "Email already registered"}), 409

    hashed = bcrypt.generate_password_hash(password).decode("utf-8")
    user_id = mongo.db.users.insert_one({
        "name": name,
        "email": email,
        "password": hashed,
        "role": "customer",
        "cart": [],
        "wishlist": [],
        "created_at": datetime.utcnow()
    }).inserted_id

    session["user_id"] = str(user_id)
    session["user_name"] = name
    session["user_role"] = "customer"
    token = create_auth_token(user_id, name, "customer")
    return jsonify({"message": "Registration successful", "token": token, "user": {"id": str(user_id), "email": email, "role": "customer"}}), 201


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    user = mongo.db.users.find_one({"email": email})
    if not user or not bcrypt.check_password_hash(user["password"], password):
        return jsonify({"error": "Invalid email or password"}), 401

    session["user_id"] = str(user["_id"])
    session["user_name"] = user["name"]
    session["user_role"] = user.get("role", "customer")
    role = user.get("role", "customer")
    token = create_auth_token(user["_id"], user["name"], role)
    return jsonify({"message": "Login successful", "token": token, "user": {"id": str(user["_id"]), "email": user["email"], "role": role}}), 200


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"message": "Logged out successfully"}), 200


@app.route("/api/me", methods=["GET"])
def me():
    identity, error_response = require_auth()
    if error_response:
        return error_response
    try:
        user = mongo.db.users.find_one({"_id": ObjectId(identity["user_id"])})
    except (InvalidId, TypeError):
        return jsonify({"error": "Not authenticated"}), 401
    if not user:
        return jsonify({"error": "User not found"}), 404
    session["user_id"] = str(user["_id"])
    session["user_name"] = user["name"]
    session["user_role"] = user.get("role", "customer")
    return jsonify({"user": {"id": str(user["_id"]), "name": user["name"], "email": user["email"], "role": user.get("role", "customer")}}), 200


# ─────────────────────────────────────────────
# PRODUCT ROUTES
# ─────────────────────────────────────────────

@app.route("/api/products", methods=["GET"])
def get_products():
    category = request.args.get("category")
    search = request.args.get("search")
    featured = request.args.get("featured")
    sort_by = request.args.get("sort", "created_at")
    page = int(request.args.get("page", 1))
    limit = int(request.args.get("limit", 8))

    query = {}
    if category:
        query["category"] = category
    if featured == "true":
        query["featured"] = True
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"description": {"$regex": search, "$options": "i"}},
            {"tags": {"$regex": search, "$options": "i"}}
        ]

    sort_map = {
        "price_asc": [("price", 1)],
        "price_desc": [("price", -1)],
        "rating": [("rating", -1)],
        "newest": [("created_at", -1)]
    }
    sort_order = sort_map.get(sort_by, [("created_at", -1)])

    total = mongo.db.products.count_documents(query)
    products = list(mongo.db.products.find(query).sort(sort_order).skip((page - 1) * limit).limit(limit))

    return jsonify({
        "products": serialize(products),
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit
    }), 200


@app.route("/api/products/<product_id>", methods=["GET"])
def get_product(product_id):
    try:
        product = mongo.db.products.find_one({"_id": ObjectId(product_id)})
    except InvalidId:
        return jsonify({"error": "Invalid product ID"}), 400
    if not product:
        return jsonify({"error": "Product not found"}), 404
    return jsonify({"product": serialize(product)}), 200


# ─────────────────────────────────────────────
# CART ROUTES
# ─────────────────────────────────────────────

@app.route("/api/cart", methods=["GET"])
def get_cart():
    identity, error_response = require_auth()
    if error_response:
        return error_response
    try:
        user = mongo.db.users.find_one({"_id": ObjectId(identity["user_id"])})
    except (InvalidId, TypeError):
        return jsonify({"error": "Not authenticated"}), 401
    if not user:
        return jsonify({"error": "User not found"}), 404
    cart = user.get("cart", [])
    cart_items = []
    for item in cart:
        try:
            product = mongo.db.products.find_one({"_id": ObjectId(item["product_id"])})
            if product:
                cart_items.append({
                    "product_id": item["product_id"],
                    "quantity": item["quantity"],
                    "name": product["name"],
                    "price": product["price"],
                    "image": product["image"],
                    "total": product["price"] * item["quantity"]
                })
        except Exception:
            pass
    grand_total = sum(i["total"] for i in cart_items)
    return jsonify({"cart": cart_items, "grand_total": grand_total}), 200


@app.route("/api/cart/add", methods=["POST"])
def add_to_cart():
    identity, error_response = require_auth()
    if error_response:
        return error_response
    data = request.get_json()
    product_id = data.get("product_id")
    quantity = int(data.get("quantity", 1))
    if quantity <= 0:
        return jsonify({"error": "Quantity must be greater than 0"}), 400

    try:
        product = mongo.db.products.find_one({"_id": ObjectId(product_id)})
    except Exception:
        return jsonify({"error": "Invalid product"}), 400
    if not product:
        return jsonify({"error": "Product not found"}), 404

    try:
        user = mongo.db.users.find_one({"_id": ObjectId(identity["user_id"])})
    except (InvalidId, TypeError):
        return jsonify({"error": "Not authenticated"}), 401
    if not user:
        return jsonify({"error": "User not found"}), 404
    cart = user.get("cart", [])
    found = False
    for item in cart:
        if item["product_id"] == product_id:
            item["quantity"] += quantity
            found = True
            break
    if not found:
        cart.append({"product_id": product_id, "quantity": quantity})

    mongo.db.users.update_one({"_id": ObjectId(identity["user_id"])}, {"$set": {"cart": cart}})
    return jsonify({"message": "Added to cart", "cart_count": len(cart)}), 200


@app.route("/api/cart/remove", methods=["POST"])
def remove_from_cart():
    identity, error_response = require_auth()
    if error_response:
        return error_response
    data = request.get_json()
    product_id = data.get("product_id")
    try:
        user = mongo.db.users.find_one({"_id": ObjectId(identity["user_id"])})
    except (InvalidId, TypeError):
        return jsonify({"error": "Not authenticated"}), 401
    if not user:
        return jsonify({"error": "User not found"}), 404
    cart = [item for item in user.get("cart", []) if item["product_id"] != product_id]
    mongo.db.users.update_one({"_id": ObjectId(identity["user_id"])}, {"$set": {"cart": cart}})
    return jsonify({"message": "Removed from cart"}), 200


@app.route("/api/cart/update", methods=["POST"])
def update_cart():
    identity, error_response = require_auth()
    if error_response:
        return error_response
    data = request.get_json()
    product_id = data.get("product_id")
    quantity = int(data.get("quantity", 1))
    if quantity <= 0:
        return jsonify({"error": "Quantity must be greater than 0"}), 400
    try:
        user = mongo.db.users.find_one({"_id": ObjectId(identity["user_id"])})
    except (InvalidId, TypeError):
        return jsonify({"error": "Not authenticated"}), 401
    if not user:
        return jsonify({"error": "User not found"}), 404
    cart = user.get("cart", [])
    for item in cart:
        if item["product_id"] == product_id:
            item["quantity"] = quantity
            break
    mongo.db.users.update_one({"_id": ObjectId(identity["user_id"])}, {"$set": {"cart": cart}})
    return jsonify({"message": "Cart updated"}), 200


# ─────────────────────────────────────────────
# ORDER ROUTES
# ─────────────────────────────────────────────

@app.route("/api/orders/place", methods=["POST"])
def place_order():
    identity, error_response = require_auth()
    if error_response:
        return error_response
    data = request.get_json()
    address = data.get("address", {})
    payment_method = data.get("payment_method", "COD")
    notify_email_from_request = data.get("notify_email", "").strip().lower()

    try:
        user = mongo.db.users.find_one({"_id": ObjectId(identity["user_id"])})
    except (InvalidId, TypeError):
        return jsonify({"error": "Not authenticated"}), 401
    if not user:
        return jsonify({"error": "User not found"}), 404
    cart = user.get("cart", [])
    if not cart:
        return jsonify({"error": "Cart is empty"}), 400

    order_items = []
    total_amount = 0
    for item in cart:
        try:
            product = mongo.db.products.find_one({"_id": ObjectId(item["product_id"])})
            if product:
                order_items.append({
                    "product_id": item["product_id"],
                    "name": product["name"],
                    "price": product["price"],
                    "quantity": item["quantity"],
                    "image": product["image"],
                    "subtotal": product["price"] * item["quantity"]
                })
                total_amount += product["price"] * item["quantity"]
        except Exception:
            pass

    if not order_items:
        return jsonify({"error": "Could not process cart items"}), 400

    tracking_id = f"TRK-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    now = datetime.utcnow()
    tracking_events = [
        {
            "status": "Confirmed",
            "message": "Order has been confirmed",
            "time": now,
        }
    ]

    order_id = mongo.db.orders.insert_one({
        "user_id": identity["user_id"],
        "user_name": identity.get("user_name", user.get("name", "Customer")),
        "user_email": user.get("email", ""),
        "items": order_items,
        "total_amount": total_amount,
        "address": address,
        "payment_method": payment_method,
        "tracking_id": tracking_id,
        "tracking_events": tracking_events,
        "estimated_delivery": "3-5 business days",
        "status": "Confirmed",
        "created_at": now
    }).inserted_id

    mongo.db.users.update_one({"_id": ObjectId(identity["user_id"])}, {"$set": {"cart": []}})

    order_mail_payload = {
        "order_id": str(order_id),
        "tracking_id": tracking_id,
        "user_name": identity.get("user_name", user.get("name", "Customer")),
        "user_email": user.get("email", ""),
        "payment_method": payment_method,
        "total_amount": total_amount,
        "status": "Confirmed",
        "items": order_items,
    }
    notify_email = notify_email_from_request or user.get("email", "") or os.getenv("ORDER_NOTIFY_EMAIL", "").strip()
    email_result = _send_order_notification_email(order_mail_payload, notify_email)

    return jsonify(
        {
            "message": "Order placed successfully",
            "order_id": str(order_id),
            "tracking_id": tracking_id,
            "notification_email": notify_email,
            "email_sent": email_result.get("sent", False),
            "email_status": email_result.get("reason", "Unknown"),
        }
    ), 201


@app.route("/api/orders", methods=["GET"])
def get_orders():
    identity, error_response = require_auth()
    if error_response:
        return error_response
    orders = list(mongo.db.orders.find({"user_id": identity["user_id"]}).sort("created_at", -1))
    return jsonify({"orders": serialize(orders)}), 200


@app.route("/api/orders/<order_id>/cancel", methods=["POST"])
def cancel_order(order_id):
    identity, error_response = require_auth()
    if error_response:
        return error_response

    try:
        oid = ObjectId(order_id)
    except InvalidId:
        return jsonify({"error": "Invalid order ID"}), 400

    order = mongo.db.orders.find_one({"_id": oid, "user_id": identity["user_id"]})
    if not order:
        return jsonify({"error": "Order not found"}), 404

    if order.get("status") in ["Cancelled", "Delivered"]:
        return jsonify({"error": f"Order cannot be cancelled when status is {order.get('status')}"}), 400

    tracking_events = order.get("tracking_events", [])
    tracking_events.append(
        {
            "status": "Cancelled",
            "message": "Order has been cancelled by customer",
            "time": datetime.utcnow(),
        }
    )

    mongo.db.orders.update_one(
        {"_id": oid},
        {
            "$set": {
                "status": "Cancelled",
                "cancelled_at": datetime.utcnow(),
                "tracking_events": tracking_events,
            }
        },
    )
    return jsonify({"message": "Order cancelled successfully"}), 200


@app.route("/api/orders/<order_id>/track", methods=["GET"])
def track_order(order_id):
    identity, error_response = require_auth()
    if error_response:
        return error_response

    try:
        oid = ObjectId(order_id)
    except InvalidId:
        return jsonify({"error": "Invalid order ID"}), 400

    order = mongo.db.orders.find_one({"_id": oid, "user_id": identity["user_id"]})
    if not order:
        return jsonify({"error": "Order not found"}), 404

    return jsonify(
        {
            "tracking": {
                "order_id": str(order["_id"]),
                "tracking_id": order.get("tracking_id", ""),
                "status": order.get("status", "Confirmed"),
                "estimated_delivery": order.get("estimated_delivery", "3-5 business days"),
                "events": serialize(order.get("tracking_events", [])),
            }
        }
    ), 200


@app.route("/api/wishlist", methods=["GET"])
def get_wishlist():
    identity, error_response = require_auth()
    if error_response:
        return error_response

    try:
        user = mongo.db.users.find_one({"_id": ObjectId(identity["user_id"])})
    except (InvalidId, TypeError):
        return jsonify({"error": "Not authenticated"}), 401

    if not user:
        return jsonify({"error": "User not found"}), 404

    wishlist_ids = user.get("wishlist", [])
    products = []
    for product_id in wishlist_ids:
        try:
            product = mongo.db.products.find_one({"_id": ObjectId(product_id)})
            if product:
                products.append(product)
        except Exception:
            pass

    return jsonify({"wishlist": serialize(products)}), 200


@app.route("/api/wishlist/add", methods=["POST"])
def add_to_wishlist():
    identity, error_response = require_auth()
    if error_response:
        return error_response

    data = request.get_json()
    product_id = data.get("product_id", "")
    try:
        ObjectId(product_id)
    except Exception:
        return jsonify({"error": "Invalid product"}), 400

    try:
        user = mongo.db.users.find_one({"_id": ObjectId(identity["user_id"])})
    except (InvalidId, TypeError):
        return jsonify({"error": "Not authenticated"}), 401

    if not user:
        return jsonify({"error": "User not found"}), 404

    wishlist = user.get("wishlist", [])
    if product_id not in wishlist:
        wishlist.append(product_id)
        mongo.db.users.update_one({"_id": ObjectId(identity["user_id"])}, {"$set": {"wishlist": wishlist}})

    return jsonify({"message": "Added to wishlist"}), 200


@app.route("/api/wishlist/remove", methods=["POST"])
def remove_from_wishlist():
    identity, error_response = require_auth()
    if error_response:
        return error_response

    data = request.get_json()
    product_id = data.get("product_id", "")
    try:
        user = mongo.db.users.find_one({"_id": ObjectId(identity["user_id"])})
    except (InvalidId, TypeError):
        return jsonify({"error": "Not authenticated"}), 401

    if not user:
        return jsonify({"error": "User not found"}), 404

    wishlist = [item for item in user.get("wishlist", []) if item != product_id]
    mongo.db.users.update_one({"_id": ObjectId(identity["user_id"])}, {"$set": {"wishlist": wishlist}})

    return jsonify({"message": "Removed from wishlist"}), 200


# ─────────────────────────────────────────────
# CATEGORIES ROUTE
# ─────────────────────────────────────────────

@app.route("/api/categories", methods=["GET"])
def get_categories():
    categories = [
        {"id": "necklace", "name": "Necklaces", "icon": "💛"},
        {"id": "earrings", "name": "Earrings", "icon": "✨"},
        {"id": "bangles", "name": "Bangles", "icon": "🟡"},
        {"id": "armlet", "name": "Armlets (Vanki)", "icon": "🔱"},
        {"id": "headjewellery", "name": "Head Jewellery", "icon": "👑"},
        {"id": "waistbelt", "name": "Waist Belt", "icon": "🎀"},
    ]
    return jsonify({"categories": categories}), 200


# ─────────────────────────────────────────────
# REVIEWS
# ─────────────────────────────────────────────

@app.route("/api/products/<product_id>/reviews", methods=["GET"])
def get_reviews(product_id):
    reviews = list(mongo.db.reviews.find({"product_id": product_id}).sort("created_at", -1))
    return jsonify({"reviews": serialize(reviews)}), 200


@app.route("/api/products/<product_id>/reviews", methods=["POST"])
def add_review(product_id):
    identity, error_response = require_auth()
    if error_response:
        return error_response
    data = request.get_json()
    rating = data.get("rating", 5)
    comment = data.get("comment", "").strip()
    if not comment:
        return jsonify({"error": "Comment is required"}), 400

    mongo.db.reviews.insert_one({
        "product_id": product_id,
        "user_id": identity["user_id"],
        "user_name": identity.get("user_name", "Customer"),
        "rating": rating,
        "comment": comment,
        "created_at": datetime.utcnow()
    })

    reviews = list(mongo.db.reviews.find({"product_id": product_id}))
    avg = sum(r["rating"] for r in reviews) / len(reviews)
    mongo.db.products.update_one({"_id": ObjectId(product_id)}, {"$set": {"rating": round(avg, 1), "reviews_count": len(reviews)}})
    return jsonify({"message": "Review added"}), 201


# ─────────────────────────────────────────────
# ADMIN ROUTES
# ─────────────────────────────────────────────

@app.route("/api/admin/products", methods=["POST"])
def admin_add_product():
    _, error_response = require_admin()
    if error_response:
        return error_response
    data = request.get_json()
    data["created_at"] = datetime.utcnow()
    data["rating"] = 0
    data["reviews_count"] = 0
    product_id = mongo.db.products.insert_one(data).inserted_id
    return jsonify({"message": "Product added", "product_id": str(product_id)}), 201


@app.route("/api/admin/stats", methods=["GET"])
def admin_stats():
    _, error_response = require_admin()
    if error_response:
        return error_response
    stats = {
        "total_products": mongo.db.products.count_documents({}),
        "total_users": mongo.db.users.count_documents({}),
        "total_orders": mongo.db.orders.count_documents({}),
        "revenue": sum(o.get("total_amount", 0) for o in mongo.db.orders.find({"status": {"$ne": "Cancelled"}}))
    }
    return jsonify({"stats": stats}), 200


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    debug_mode = os.getenv("FLASK_DEBUG", "0") == "1"
    app.run(
        host="0.0.0.0",
        port=port,
        debug=debug_mode,
        use_reloader=False,
    )
