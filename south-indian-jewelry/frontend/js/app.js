const isFlaskOrigin = window.location.port === "5000";
const apiHost = window.location.hostname || "127.0.0.1";
const pageProtocol = window.location.protocol === "https:" ? "https" : "http";
const configuredApiBase = (localStorage.getItem("apiBaseUrl") || "").trim();
const deployedApiBase = "https://aws-project-2.onrender.com/api";
const API_BASE_CANDIDATES = isFlaskOrigin
  ? ["/api"]
  : [
  ...(configuredApiBase ? [configuredApiBase] : []),
  deployedApiBase,
  "/api",
      `${pageProtocol}://${apiHost}:5000/api`,
      `http://${apiHost}:5000/api`,
      "http://127.0.0.1:5000/api",
      "http://localhost:5000/api",
    ];
let activeApiBase = API_BASE_CANDIDATES[0];
let authToken = localStorage.getItem("authToken") || "";
let currentUser = null;
let wishlistSet = new Set();
let activeProduct = null;

const productsGrid = document.getElementById("productsGrid");
const categoryFilter = document.getElementById("categoryFilter");
const searchInput = document.getElementById("searchInput");
const cartItems = document.getElementById("cartItems");
const cartTotal = document.getElementById("cartTotal");
const ordersBox = document.getElementById("ordersBox");
const wishlistItems = document.getElementById("wishlistItems");
const userLabel = document.getElementById("userLabel");
const logoutBtn = document.getElementById("logoutBtn");
const trackPageLink = document.getElementById("trackPageLink");
const authView = document.getElementById("authView");
const shopView = document.getElementById("shopView");
const signupCard = document.getElementById("signupCard");
const loginCard = document.getElementById("loginCard");

const productModal = document.getElementById("productModal");
const productImage = document.getElementById("productImage");
const productTitle = document.getElementById("productTitle");
const productDesc = document.getElementById("productDesc");
const productMeta = document.getElementById("productMeta");
const productPrice = document.getElementById("productPrice");
const productOldPrice = document.getElementById("productOldPrice");
const detailAddCartBtn = document.getElementById("detailAddCartBtn");
const detailLikeBtn = document.getElementById("detailLikeBtn");
const detailBuyBtn = document.getElementById("detailBuyBtn");
const detailShareBtn = document.getElementById("detailShareBtn");
const closeModalBtn = document.getElementById("closeModalBtn");
const placeOrderBtn = document.getElementById("placeOrderBtn");
const paymentMethodButtons = document.querySelectorAll(".payment-method-btn");
const upiIdWrap = document.getElementById("upiIdWrap");
const upiAppWrap = document.getElementById("upiAppWrap");
const upiIdInput = document.getElementById("upiIdInput");
const upiAppSelect = document.getElementById("upiAppSelect");
const cardNumberWrap = document.getElementById("cardNumberWrap");
const cardNumberInput = document.getElementById("cardNumberInput");
const netBankWrap = document.getElementById("netBankWrap");
const netBankSelect = document.getElementById("netBankSelect");
const scanPayWrap = document.getElementById("scanPayWrap");
const scanRefInput = document.getElementById("scanRefInput");
const scanCameraBtn = document.getElementById("scanCameraBtn");
const scanCameraStopBtn = document.getElementById("scanCameraStopBtn");
const scanVideo = document.getElementById("scanVideo");
const scanCameraStatus = document.getElementById("scanCameraStatus");

let revealObserver = null;
let selectedPaymentMethod = "UPI_ID";
let scanStream = null;
let scanFrameRequestId = 0;
const qrDetector = typeof window !== "undefined" && "BarcodeDetector" in window
  ? new window.BarcodeDetector({ formats: ["qr_code"] })
  : null;

function updateScanStatus(message) {
  if (!scanCameraStatus) return;
  scanCameraStatus.textContent = message;
}

function stopScanCamera(resetStatus = true) {
  if (scanFrameRequestId) {
    window.cancelAnimationFrame(scanFrameRequestId);
    scanFrameRequestId = 0;
  }

  if (scanStream) {
    scanStream.getTracks().forEach((track) => track.stop());
    scanStream = null;
  }

  if (scanVideo) {
    scanVideo.pause();
    scanVideo.srcObject = null;
    scanVideo.classList.add("hidden");
  }

  if (scanCameraBtn) scanCameraBtn.classList.remove("hidden");
  if (scanCameraStopBtn) scanCameraStopBtn.classList.add("hidden");

  if (resetStatus) {
    updateScanStatus("Use camera to scan UPI QR and auto-fill reference.");
  }
}

async function detectQrLoop() {
  if (!scanVideo || !qrDetector || !scanStream) return;

  try {
    const detectedCodes = await qrDetector.detect(scanVideo);
    if (detectedCodes.length) {
      const qrText = (detectedCodes[0].rawValue || "").trim();
      if (qrText) {
        if (scanRefInput) {
          scanRefInput.value = qrText;
        }
        updateScanStatus("QR scanned successfully. Reference auto-filled.");
        showToast("QR scanned successfully");
        stopScanCamera(false);
        return;
      }
    }
  } catch {
  }

  scanFrameRequestId = window.requestAnimationFrame(detectQrLoop);
}

async function startScanCamera() {
  if (!scanVideo || !scanCameraBtn || !scanCameraStopBtn) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    updateScanStatus("Camera API not available in this browser. Enter reference manually.");
    showToast("Camera not supported in this browser");
    return;
  }

  if (!qrDetector) {
    updateScanStatus("QR scanning is not supported here. Enter reference manually.");
    showToast("QR scanner is not supported in this browser");
    return;
  }

  stopScanCamera(false);

  try {
    updateScanStatus("Requesting camera permission...");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    scanStream = stream;
    scanVideo.srcObject = stream;
    await scanVideo.play();

    scanVideo.classList.remove("hidden");
    scanCameraBtn.classList.add("hidden");
    scanCameraStopBtn.classList.remove("hidden");
    updateScanStatus("Camera started. Point it at the payment QR code.");

    scanFrameRequestId = window.requestAnimationFrame(detectQrLoop);
  } catch {
    stopScanCamera(false);
    updateScanStatus("Unable to access camera. Check permission or enter reference manually.");
    showToast("Unable to access camera");
  }
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function setButtonLoading(button, isLoading, loadingText = "Please wait...") {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${loadingText}`;
    return;
  }
  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
  }
  button.disabled = false;
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const orderedBases = [
    activeApiBase,
    ...API_BASE_CANDIDATES.filter((base) => base !== activeApiBase),
  ];

  let lastNetworkError = null;
  let lastApiError = null;
  for (const base of orderedBases) {
    try {
      const response = await fetch(`${base}${path}`, {
        headers,
        credentials: "include",
        ...options,
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 && authToken) {
        authToken = "";
        localStorage.removeItem("authToken");
      }

      if (!response.ok) {
        const shouldTryNextBase =
          response.status === 404
          || response.status === 405
          || response.status >= 500;

        lastApiError = new Error(data.error || `Request failed (${response.status})`);
        if (shouldTryNextBase) {
          continue;
        }
        throw lastApiError;
      }

      activeApiBase = base;
      return data;
    } catch (error) {
      if (error instanceof TypeError) {
        lastNetworkError = error;
        continue;
      }
      throw error;
    }
  }

  throw (
    lastNetworkError
    || lastApiError
    || new Error("Unable to connect to backend API. Open app using http://127.0.0.1:5000/")
  );
}

function currency(amount) {
  return new Intl.NumberFormat("en-IN").format(amount || 0);
}

function isLoggedIn() {
  return Boolean(currentUser && currentUser.id);
}

function showAuthMode(mode) {
  if (mode === "login") {
    loginCard.classList.remove("hidden");
    signupCard.classList.add("hidden");
    return;
  }
  signupCard.classList.remove("hidden");
  loginCard.classList.add("hidden");
}

function refreshLayout() {
  if (isLoggedIn()) {
    authView.classList.add("hidden");
    shopView.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
    trackPageLink.classList.remove("hidden");
    userLabel.textContent = currentUser.name || currentUser.email || "User";
    return;
  }

  authView.classList.remove("hidden");
  shopView.classList.add("hidden");
  logoutBtn.classList.add("hidden");
  trackPageLink.classList.add("hidden");
  userLabel.textContent = "Guest";
}

function updatePaymentInputVisibility() {
  if (!upiIdWrap || !upiAppWrap || !cardNumberWrap || !netBankWrap || !scanPayWrap) return;

  upiIdWrap.classList.toggle("hidden", selectedPaymentMethod !== "UPI_ID");
  upiAppWrap.classList.toggle("hidden", selectedPaymentMethod !== "UPI_APP");
  cardNumberWrap.classList.toggle("hidden", selectedPaymentMethod !== "CARD");
  netBankWrap.classList.toggle("hidden", selectedPaymentMethod !== "NET_BANKING");
  scanPayWrap.classList.toggle("hidden", selectedPaymentMethod !== "SCAN_PAY");

  paymentMethodButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.payment === selectedPaymentMethod);
  });

  if (selectedPaymentMethod !== "SCAN_PAY") {
    stopScanCamera();
  }
}

function resolvePaymentMethod() {
  if (!paymentMethodButtons.length) {
    return { ok: true, paymentMethod: "COD" };
  }

  const selectedMethod = selectedPaymentMethod;
  if (selectedMethod === "UPI_ID") {
    const upiId = (upiIdInput?.value || "").trim();
    if (!upiId) {
      return { ok: false, message: "Please enter a UPI ID" };
    }
    return {
      ok: true,
      paymentMethod: `UPI ID (${upiId})`,
    };
  }

  if (selectedMethod === "UPI_APP") {
    const upiApp = upiAppSelect?.value || "UPI App";
    return {
      ok: true,
      paymentMethod: `UPI App (${upiApp})`,
    };
  }

  if (selectedMethod === "CARD") {
    const rawCardNumber = (cardNumberInput?.value || "").replace(/\s+/g, "");
    if (!/^\d{12,19}$/.test(rawCardNumber)) {
      return { ok: false, message: "Please enter a valid card number" };
    }
    const masked = `**** **** **** ${rawCardNumber.slice(-4)}`;
    return {
      ok: true,
      paymentMethod: `Credit / Debit Card (${masked})`,
    };
  }

  if (selectedMethod === "NET_BANKING") {
    const selectedBank = (netBankSelect?.value || "").trim();
    if (!selectedBank) {
      return { ok: false, message: "Please choose your bank" };
    }
    return {
      ok: true,
      paymentMethod: `Net Banking (${selectedBank})`,
    };
  }

  if (selectedMethod === "SCAN_PAY") {
    const scanReference = (scanRefInput?.value || "").trim();
    if (!scanReference) {
      return { ok: false, message: "Please enter Scan & Pay reference" };
    }
    return {
      ok: true,
      paymentMethod: `Scan & Pay (${scanReference})`,
    };
  }

  return { ok: true, paymentMethod: "COD" };
}

function observeReveal(element) {
  if (!element) return;
  if (!revealObserver) {
    element.classList.add("is-visible");
    return;
  }
  revealObserver.observe(element);
}

function initAnimations() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealElements = document.querySelectorAll(".animate-reveal");

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealElements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
  );

  revealElements.forEach((element) => observeReveal(element));
}

function statusClassName(status) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "confirmed") return "status-confirmed";
  if (normalized === "cancelled") return "status-cancelled";
  if (normalized === "delivered") return "status-delivered";
  return "status-default";
}

function setLikeButtonState(isLiked) {
  detailLikeBtn.innerHTML = isLiked
    ? '<i class="fa-solid fa-heart"></i>'
    : '<i class="fa-regular fa-heart"></i>';
  detailLikeBtn.setAttribute("aria-label", isLiked ? "Unlike" : "Like");
}

async function loadCategories() {
  try {
    const data = await api("/categories");
    categoryFilter.innerHTML = '<option value="">All Categories</option>';
    data.categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = category.name;
      categoryFilter.appendChild(option);
    });
  } catch (error) {
    showToast(error.message || "Could not load categories");
  }
}

function createProductCard(product) {
  const card = document.createElement("article");
  card.className = "product-card";
  card.innerHTML = `
    <img src="${product.image}" alt="${product.name}" />
    <div class="product-content">
      <h4>${product.name}</h4>
      <div class="price">
        <span class="current">₹${currency(product.price)}</span>
        <span class="old">₹${currency(product.original_price || product.price)}</span>
      </div>
      <div class="product-actions">
        <button class="btn" data-role="details">View Details</button>
        <button class="btn secondary" data-role="cart"><i class="fa-solid fa-cart-plus"></i> Add</button>
      </div>
    </div>
  `;

  card.querySelector('[data-role="details"]').addEventListener("click", () => {
    openProductModal(product);
  });

  card.querySelector('[data-role="cart"]').addEventListener("click", async () => {
    try {
      await api("/cart/add", {
        method: "POST",
        body: JSON.stringify({ product_id: product._id, quantity: 1 }),
      });
      showToast("Added to cart");
      loadCart();
    } catch (error) {
      showToast(error.message);
    }
  });
  card.classList.add("animate-reveal");
  observeReveal(card);
  return card;
}

async function loadProducts() {
  if (!isLoggedIn()) return;
  try {
    const params = new URLSearchParams();
    if (categoryFilter.value) params.set("category", categoryFilter.value);
    if (searchInput.value.trim()) params.set("search", searchInput.value.trim());

    const query = params.toString() ? `/products?${params.toString()}` : "/products";
    const data = await api(query);
    productsGrid.innerHTML = "";

    if (!data.products.length) {
      productsGrid.innerHTML = "<p>No products found.</p>";
      return;
    }

    data.products.forEach((product) => {
      productsGrid.appendChild(createProductCard(product));
    });
  } catch {
    productsGrid.innerHTML = "<p>Unable to load products.</p>";
  }
}

function openProductModal(product) {
  activeProduct = product;
  productImage.src = product.image;
  productTitle.textContent = product.name;
  productDesc.textContent = product.description || "No description available.";
  productMeta.textContent = `${product.material || "Traditional Jewelry"} • ${product.weight || "N/A"} • ${product.occasion || "Wedding"}`;
  productPrice.textContent = `₹${currency(product.price)}`;
  productOldPrice.textContent = `₹${currency(product.original_price || product.price)}`;
  setLikeButtonState(wishlistSet.has(product._id));
  productModal.classList.remove("hidden");
}

function closeProductModal() {
  productModal.classList.add("hidden");
  activeProduct = null;
}

async function loadCart() {
  if (!isLoggedIn()) return;
  try {
    const data = await api("/cart");
    cartItems.innerHTML = "";

    if (!data.cart.length) {
      cartItems.innerHTML = "<p>Your cart is empty.</p>";
      cartTotal.textContent = "0";
      return;
    }

    data.cart.forEach((item) => {
      const row = document.createElement("div");
      row.className = "cart-row";
      row.innerHTML = `
        <div class="cart-item-left">
          <img class="cart-thumb" src="${item.image}" alt="${item.name}" />
          <div>
            <strong>${item.name}</strong><br>
            <small>Qty: ${item.quantity}</small>
          </div>
        </div>
        <div class="cart-item-right">
          ₹${currency(item.total)}
          <button class="btn danger icon-btn" aria-label="Delete item" data-role="remove" data-id="${item.product_id}"><i class="fa-solid fa-trash"></i></button>
        </div>
      `;
      row.querySelector('[data-role="remove"]').addEventListener("click", async () => {
        try {
          await api("/cart/remove", {
            method: "POST",
            body: JSON.stringify({ product_id: item.product_id }),
          });
          showToast("Removed from cart");
          loadCart();
        } catch (error) {
          showToast(error.message);
        }
      });
      cartItems.appendChild(row);
    });

    cartTotal.textContent = currency(data.grand_total);
  } catch {
    cartItems.innerHTML = "<p>Login to view cart.</p>";
  }
}

async function loadOrders() {
  if (!isLoggedIn()) return;
  try {
    const data = await api("/orders");
    ordersBox.innerHTML = "";

    if (!data.orders.length) {
      ordersBox.innerHTML = "<p>No orders yet.</p>";
      return;
    }

    data.orders.forEach((order) => {
      const row = document.createElement("div");
      row.className = "order-row";
      row.innerHTML = `
        <div>
          <strong>Order:</strong> ${order._id}<br>
          <small><strong>Track ID:</strong> ${order.tracking_id || "-"}</small><br>
          <small><strong>Payment:</strong> ${order.payment_method || "-"}</small><br>
          <small>${new Date(order.created_at).toLocaleString()}</small>
        </div>
        <div>
          ₹${currency(order.total_amount)} <span class="order-status ${statusClassName(order.status)}">${order.status}</span>
          <div class="order-actions">
            <a class="btn secondary order-track-btn" href="./tracking.html?orderId=${order._id}"><i class="fa-solid fa-truck-fast"></i> Track</a>
            ${order.status !== "Cancelled" && order.status !== "Delivered" ? `<button class="btn danger" data-role="cancel" data-id="${order._id}"><i class="fa-solid fa-ban"></i> Cancel</button>` : ""}
          </div>
        </div>
      `;

      const cancelBtn = row.querySelector('[data-role="cancel"]');
      if (cancelBtn) {
        cancelBtn.addEventListener("click", async () => {
          try {
            await api(`/orders/${order._id}/cancel`, { method: "POST", body: JSON.stringify({}) });
            showToast("Order cancelled");
            loadOrders();
          } catch (error) {
            showToast(error.message || "Could not cancel order");
          }
        });
      }

      ordersBox.appendChild(row);
    });
  } catch {
    ordersBox.innerHTML = "<p>Login to view orders.</p>";
  }
}

async function loadWishlist() {
  if (!isLoggedIn()) return;
  try {
    const data = await api("/wishlist");
    wishlistSet = new Set((data.wishlist || []).map((item) => item._id));
    wishlistItems.innerHTML = "";

    if (!data.wishlist.length) {
      wishlistItems.innerHTML = "<p>No liked items yet.</p>";
      return;
    }

    data.wishlist.forEach((product) => {
      const row = document.createElement("div");
      row.className = "wishlist-card";
      row.innerHTML = `
        <div class="wishlist-card-media">
          <img class="cart-thumb" src="${product.image}" alt="${product.name}" />
          <div><strong>${product.name}</strong></div>
        </div>
        <div class="wishlist-card-actions">
          <button class="btn secondary" data-role="view">View</button>
          <button class="btn danger icon-btn" aria-label="Delete liked item" data-role="remove"><i class="fa-solid fa-trash"></i></button>
        </div>
      `;

      row.querySelector('[data-role="view"]').addEventListener("click", () => openProductModal(product));
      row.querySelector('[data-role="remove"]').addEventListener("click", async () => {
        try {
          await api("/wishlist/remove", {
            method: "POST",
            body: JSON.stringify({ product_id: product._id }),
          });
          showToast("Removed from liked items");
          loadWishlist();
        } catch (error) {
          showToast(error.message || "Unable to update liked items");
        }
      });

      wishlistItems.appendChild(row);
    });
  } catch {
    wishlistItems.innerHTML = "<p>Login to view liked items.</p>";
  }
}

async function refreshSessionState() {
  try {
    const response = await api("/me");
    currentUser = response.user;
  } catch (error) {
    currentUser = null;
    const message = (error?.message || "").toLowerCase();
    const isAuthError = message.includes("not authenticated") || message.includes("401");
    if (isAuthError) {
      authToken = "";
      localStorage.removeItem("authToken");
    }
  }
  refreshLayout();
}

function applyAuthStateFromResponse(response) {
  if (response.token) {
    authToken = response.token;
    localStorage.setItem("authToken", authToken);
  }

  if (response.user && response.user.id) {
    currentUser = {
      ...response.user,
      name: response.user.name || response.user.email || "User",
    };
    refreshLayout();
  }
}

document.getElementById("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const response = await api("/register", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("regName").value,
        email: document.getElementById("regEmail").value,
        password: document.getElementById("regPassword").value,
      }),
    });
    applyAuthStateFromResponse(response);
    form.reset();
    showToast("Registration successful");
    await refreshSessionState();
    await loadProducts();
    await loadWishlist();
    loadCart();
    loadOrders();
  } catch (error) {
    showToast(error.message);
  }
});

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const response = await api("/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("loginEmail").value,
        password: document.getElementById("loginPassword").value,
      }),
    });
    applyAuthStateFromResponse(response);
    form.reset();
    showToast("Login successful");
    await refreshSessionState();
    await loadProducts();
    await loadWishlist();
    loadCart();
    loadOrders();
  } catch (error) {
    showToast(error.message);
  }
});

document.getElementById("searchBtn").addEventListener("click", loadProducts);
document.getElementById("refreshCartBtn").addEventListener("click", loadCart);

placeOrderBtn.addEventListener("click", async () => {
  setButtonLoading(placeOrderBtn, true, "Placing...");
  try {
    const paymentInfo = resolvePaymentMethod();
    if (!paymentInfo.ok) {
      showToast(paymentInfo.message || "Please select a payment method");
      return;
    }

    const response = await api("/orders/place", {
      method: "POST",
      body: JSON.stringify({
        payment_method: paymentInfo.paymentMethod,
        address: {
          line1: "Demo Address",
          city: "Chennai",
          state: "Tamil Nadu",
          pincode: "600001",
        },
      }),
    });
    if (response.email_sent) {
      showToast(`Order placed. Tracking ID: ${response.tracking_id}. Email sent to ${response.notification_email}`);
    } else {
      showToast(`Order placed. Email not sent: ${response.email_status}`);
    }
    loadCart();
    loadOrders();
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonLoading(placeOrderBtn, false);
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await api("/logout", { method: "POST", body: JSON.stringify({}) });
    authToken = "";
    localStorage.removeItem("authToken");
    currentUser = null;
    showToast("Logged out");
    refreshLayout();
    showAuthMode("login");
  } catch (error) {
    showToast(error.message);
  }
});

document.getElementById("goToLogin").addEventListener("click", (event) => {
  event.preventDefault();
  showAuthMode("login");
});

document.getElementById("goToSignup").addEventListener("click", (event) => {
  event.preventDefault();
  showAuthMode("signup");
});

closeModalBtn.addEventListener("click", closeProductModal);
productModal.addEventListener("click", (event) => {
  if (event.target === productModal) closeProductModal();
});

detailAddCartBtn.addEventListener("click", async () => {
  if (!activeProduct) return;
  setButtonLoading(detailAddCartBtn, true, "Adding...");
  try {
    await api("/cart/add", {
      method: "POST",
      body: JSON.stringify({ product_id: activeProduct._id, quantity: 1 }),
    });
    showToast("Added to cart");
    loadCart();
  } catch (error) {
    showToast(error.message || "Unable to add to cart");
  } finally {
    setButtonLoading(detailAddCartBtn, false);
  }
});

detailLikeBtn.addEventListener("click", async () => {
  if (!activeProduct) return;
  try {
    if (wishlistSet.has(activeProduct._id)) {
      await api("/wishlist/remove", {
        method: "POST",
        body: JSON.stringify({ product_id: activeProduct._id }),
      });
      showToast("Removed from liked items");
    } else {
      await api("/wishlist/add", {
        method: "POST",
        body: JSON.stringify({ product_id: activeProduct._id }),
      });
      showToast("Added to liked items");
    }
    await loadWishlist();
    setLikeButtonState(wishlistSet.has(activeProduct._id));
  } catch (error) {
    showToast(error.message || "Unable to update liked items");
  }
});

detailBuyBtn.addEventListener("click", async () => {
  if (!activeProduct) return;
  setButtonLoading(detailBuyBtn, true, "Ordering...");
  try {
    const paymentInfo = resolvePaymentMethod();
    if (!paymentInfo.ok) {
      showToast(paymentInfo.message || "Please select a payment method");
      return;
    }

    await api("/cart/add", {
      method: "POST",
      body: JSON.stringify({ product_id: activeProduct._id, quantity: 1 }),
    });
    const response = await api("/orders/place", {
      method: "POST",
      body: JSON.stringify({
        payment_method: paymentInfo.paymentMethod,
        address: {
          line1: "Demo Address",
          city: "Chennai",
          state: "Tamil Nadu",
          pincode: "600001",
        },
      }),
    });
    if (response.email_sent) {
      showToast(`Order placed. Tracking ID: ${response.tracking_id}. Email sent to ${response.notification_email}`);
    } else {
      showToast(`Order placed. Email not sent: ${response.email_status}`);
    }
    closeProductModal();
    loadCart();
    loadOrders();
  } catch (error) {
    showToast(error.message || "Unable to place order");
  } finally {
    setButtonLoading(detailBuyBtn, false);
  }
});

detailShareBtn.addEventListener("click", async () => {
  if (!activeProduct) return;
  setButtonLoading(detailShareBtn, true, "Sharing...");
  const shareText = `${activeProduct.name} - ₹${currency(activeProduct.price)}`;
  const shareUrl = `${window.location.origin}${window.location.pathname}#product-${activeProduct._id}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: activeProduct.name, text: shareText, url: shareUrl });
    } else {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
    }
    showToast("Share link ready");
  } catch {
    showToast("Share cancelled");
  } finally {
    setButtonLoading(detailShareBtn, false);
  }
});

async function init() {
  const path = (window.location.pathname || "/").toLowerCase();
  initAnimations();

  if (path.endsWith("/login")) {
    showAuthMode("login");
  } else {
    showAuthMode("signup");
  }

  paymentMethodButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedPaymentMethod = button.dataset.payment || "UPI_ID";
      updatePaymentInputVisibility();
    });
  });
  updatePaymentInputVisibility();

  if (scanCameraBtn) {
    scanCameraBtn.addEventListener("click", () => {
      startScanCamera();
    });
  }

  if (scanCameraStopBtn) {
    scanCameraStopBtn.addEventListener("click", () => {
      stopScanCamera(false);
      updateScanStatus("Camera stopped. You can enter reference manually.");
    });
  }

  window.addEventListener("beforeunload", () => {
    stopScanCamera(false);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopScanCamera(false);
    }
  });

  if (cardNumberInput) {
    cardNumberInput.addEventListener("input", () => {
      const digitsOnly = cardNumberInput.value.replace(/\D/g, "").slice(0, 19);
      const grouped = digitsOnly.replace(/(.{4})/g, "$1 ").trim();
      cardNumberInput.value = grouped;
    });
  }

  refreshLayout();
  await loadCategories();
  await refreshSessionState();
  if (isLoggedIn()) {
    await loadProducts();
    await loadWishlist();
    await loadCart();
    await loadOrders();
  }
}

init();
