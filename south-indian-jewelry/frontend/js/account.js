const isFlaskOrigin = window.location.port === "5000";
const apiHost = window.location.hostname || "127.0.0.1";
const pageProtocol = window.location.protocol === "https:" ? "https" : "http";
const configuredApiBaseRaw = (localStorage.getItem("apiBaseUrl") || "").trim();
const defaultBackendApiBase = "http://127.0.0.1:5000/api";
const configuredApiBase = configuredApiBaseRaw
  ? configuredApiBaseRaw.replace(/\/+$/, "").endsWith("/api")
    ? configuredApiBaseRaw.replace(/\/+$/, "")
    : `${configuredApiBaseRaw.replace(/\/+$/, "")}/api`
  : "";

const API_BASE_CANDIDATES = isFlaskOrigin
  ? ["/api"]
  : [
      configuredApiBase || defaultBackendApiBase,
      "/api",
      `${pageProtocol}://${apiHost}:5000/api`,
      `http://${apiHost}:5000/api`,
      "http://127.0.0.1:5000/api",
      "http://localhost:5000/api",
    ];

let activeApiBase = API_BASE_CANDIDATES[0];
let authToken = localStorage.getItem("authToken") || "";
let currentUser = null;
let selectedPaymentMethod = "UPI_ID";
let scanStream = null;
let scanFrameRequestId = 0;
const qrDetector = typeof window !== "undefined" && "BarcodeDetector" in window
  ? new window.BarcodeDetector({ formats: ["qr_code"] })
  : null;

const userLabel = document.getElementById("userLabel");
const logoutBtn = document.getElementById("logoutBtn");
const cartItems = document.getElementById("cartItems");
const cartTotal = document.getElementById("cartTotal");
const ordersBox = document.getElementById("ordersBox");
const wishlistItems = document.getElementById("wishlistItems");
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
const refreshCartBtn = document.getElementById("refreshCartBtn");

function initAnimations() {
  const revealElements = document.querySelectorAll(".animate-reveal");
  revealElements.forEach((element) => element.classList.add("is-visible"));
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function currency(amount) {
  return new Intl.NumberFormat("en-IN").format(amount || 0);
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
          response.status === 404 || response.status === 405 || response.status >= 500;
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

  throw lastNetworkError || lastApiError || new Error("Unable to connect to backend API");
}

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
        if (scanRefInput) scanRefInput.value = qrText;
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
    updateScanStatus("Unable to access camera. Enter reference manually.");
    showToast("Unable to access camera");
  }
}

function updatePaymentInputVisibility() {
  upiIdWrap?.classList.toggle("hidden", selectedPaymentMethod !== "UPI_ID");
  upiAppWrap?.classList.toggle("hidden", selectedPaymentMethod !== "UPI_APP");
  cardNumberWrap?.classList.toggle("hidden", selectedPaymentMethod !== "CARD");
  netBankWrap?.classList.toggle("hidden", selectedPaymentMethod !== "NET_BANKING");
  scanPayWrap?.classList.toggle("hidden", selectedPaymentMethod !== "SCAN_PAY");

  paymentMethodButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.payment === selectedPaymentMethod);
  });

  if (selectedPaymentMethod !== "SCAN_PAY") {
    stopScanCamera();
  }
}

function resolvePaymentMethod() {
  const selectedMethod = selectedPaymentMethod;
  if (selectedMethod === "UPI_ID") {
    const upiId = (upiIdInput?.value || "").trim();
    if (!upiId) return { ok: false, message: "Please enter a UPI ID" };
    return { ok: true, paymentMethod: `UPI ID (${upiId})` };
  }

  if (selectedMethod === "UPI_APP") {
    const upiApp = upiAppSelect?.value || "UPI App";
    return { ok: true, paymentMethod: `UPI App (${upiApp})` };
  }

  if (selectedMethod === "CARD") {
    const rawCardNumber = (cardNumberInput?.value || "").replace(/\s+/g, "");
    if (!/^\d{12,19}$/.test(rawCardNumber)) {
      return { ok: false, message: "Please enter a valid card number" };
    }
    const masked = `**** **** **** ${rawCardNumber.slice(-4)}`;
    return { ok: true, paymentMethod: `Credit / Debit Card (${masked})` };
  }

  if (selectedMethod === "NET_BANKING") {
    const selectedBank = (netBankSelect?.value || "").trim();
    if (!selectedBank) return { ok: false, message: "Please choose your bank" };
    return { ok: true, paymentMethod: `Net Banking (${selectedBank})` };
  }

  if (selectedMethod === "SCAN_PAY") {
    const scanReference = (scanRefInput?.value || "").trim();
    if (!scanReference) return { ok: false, message: "Please enter Scan & Pay reference" };
    return { ok: true, paymentMethod: `Scan & Pay (${scanReference})` };
  }

  return { ok: true, paymentMethod: "COD" };
}

function statusClassName(status) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "confirmed") return "status-confirmed";
  if (normalized === "cancelled") return "status-cancelled";
  if (normalized === "delivered") return "status-delivered";
  return "status-default";
}

async function loadCart() {
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
  try {
    const data = await api("/wishlist");
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
          <a class="btn secondary" href="./index.html#product-${product._id}">Open in Shop</a>
          <button class="btn danger icon-btn" aria-label="Delete liked item" data-role="remove"><i class="fa-solid fa-trash"></i></button>
        </div>
      `;

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
    userLabel.textContent = currentUser.name || currentUser.email || "User";
    return true;
  } catch {
    currentUser = null;
    userLabel.textContent = "Guest";
    if (wishlistItems) {
      wishlistItems.innerHTML = '<p>Login required to view liked items. <a href="/login">Go to Login</a></p>';
    }
    if (cartItems) {
      cartItems.innerHTML = '<p>Login required to view cart. <a href="/login">Go to Login</a></p>';
    }
    if (ordersBox) {
      ordersBox.innerHTML = '<p>Login required to view orders. <a href="/login">Go to Login</a></p>';
    }
    showToast("Please login to view account details");
    return false;
  }
}

if (refreshCartBtn) {
  refreshCartBtn.addEventListener("click", loadCart);
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await api("/logout", { method: "POST", body: JSON.stringify({}) });
      authToken = "";
      localStorage.removeItem("authToken");
      showToast("Logged out");
      window.location.href = "/login";
    } catch (error) {
      showToast(error.message || "Unable to logout");
    }
  });
}

if (placeOrderBtn) {
  placeOrderBtn.addEventListener("click", async () => {
    const paymentInfo = resolvePaymentMethod();
    if (!paymentInfo.ok) {
      showToast(paymentInfo.message || "Please select a payment method");
      return;
    }

    try {
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
        showToast(`Order placed. Tracking ID: ${response.tracking_id}`);
      } else {
        showToast(`Order placed. Email not sent: ${response.email_status}`);
      }
      await loadCart();
      await loadOrders();
    } catch (error) {
      showToast(error.message || "Unable to place order");
    }
  });
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

if (cardNumberInput) {
  cardNumberInput.addEventListener("input", () => {
    const digitsOnly = cardNumberInput.value.replace(/\D/g, "").slice(0, 19);
    const grouped = digitsOnly.replace(/(.{4})/g, "$1 ").trim();
    cardNumberInput.value = grouped;
  });
}

window.addEventListener("beforeunload", () => {
  stopScanCamera(false);
});

(async function init() {
  initAnimations();
  const isAuthenticated = await refreshSessionState();
  if (!isAuthenticated) {
    return;
  }
  await loadWishlist();
  await loadCart();
  await loadOrders();
})();
