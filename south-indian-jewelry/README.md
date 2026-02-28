# South Indian Wedding Jewelry Online

Full-stack project using:
- Frontend: HTML, CSS, JavaScript
- Backend: Python Flask
- Database: MongoDB

## Project Structure

- `backend/` Flask API server
- `frontend/` static website (HTML/CSS/JS)

## 1) Backend Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Update `backend/.env` if your MongoDB URI is different.

For order email notification to Gmail, add these keys in `backend/.env`:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=yourgmail@gmail.com
SMTP_PASSWORD=your_gmail_app_password
ORDER_NOTIFY_EMAIL=yourgmail@gmail.com
```

Run backend:

```bash
python app.py
```

Server starts at `http://127.0.0.1:5000`

## 2) Frontend Setup

Use VS Code Live Server extension or any static server and open `frontend/index.html`.

Recommended URL:
- `http://127.0.0.1:5500/frontend/index.html`

## Available API Endpoints

- `POST /api/register`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`
- `GET /api/products`
- `GET /api/products/<product_id>`
- `GET /api/cart`
- `POST /api/cart/add`
- `POST /api/cart/remove`
- `POST /api/cart/update`
- `POST /api/orders/place`
- `GET /api/orders`
- `POST /api/orders/<order_id>/cancel`
- `GET /api/orders/<order_id>/track`
- `GET /api/categories`
- `GET /api/wishlist`
- `POST /api/wishlist/add`
- `POST /api/wishlist/remove`
- `GET /api/products/<product_id>/reviews`
- `POST /api/products/<product_id>/reviews`
- `POST /api/admin/products`
- `GET /api/admin/stats`

## Notes

- Sample products are auto-seeded on first backend run.
- Default session-based auth is used.
- Make sure MongoDB is running locally before starting the backend.
- Gmail sending requires an App Password (regular account password will fail).
