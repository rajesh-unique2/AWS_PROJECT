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

const orderSelect = document.getElementById("orderSelect");
const trackingDetails = document.getElementById("trackingDetails");

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
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

function statusClassName(status) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "confirmed") return "status-confirmed";
  if (normalized === "cancelled") return "status-cancelled";
  if (normalized === "delivered") return "status-delivered";
  return "status-default";
}

function statusBadge(status) {
  return `<span class="status-pill ${statusClassName(status)}">${status}</span>`;
}

function getProgressMeta(status) {
  const normalized = (status || "").toLowerCase();
  const steps = ["Ordered", "Packed", "Shipped", "Out for Delivery", "Delivered"];

  if (normalized === "cancelled") {
    return { steps, activeStep: -1, percent: 0, cancelled: true };
  }
  if (normalized === "delivered") {
    return { steps, activeStep: 4, percent: 100, cancelled: false };
  }
  if (normalized === "out for delivery") {
    return { steps, activeStep: 3, percent: 85, cancelled: false };
  }
  if (normalized === "shipped") {
    return { steps, activeStep: 2, percent: 65, cancelled: false };
  }
  if (normalized === "packed") {
    return { steps, activeStep: 1, percent: 40, cancelled: false };
  }
  return { steps, activeStep: 0, percent: 15, cancelled: false };
}

function renderProgress(status) {
  const meta = getProgressMeta(status);
  const points = meta.steps
    .map((step, index) => {
      let className = "pending";
      if (meta.cancelled) {
        className = "cancelled";
      } else if (index < meta.activeStep) {
        className = "done";
      } else if (index === meta.activeStep) {
        className = "active";
      }
      return `<li class="${className}"><span class="point-dot"></span><span class="point-label">${step}</span></li>`;
    })
    .join("");

  const percentageLabel = meta.cancelled ? "Cancelled" : `${meta.percent}%`;
  const progressClass = meta.cancelled ? "tracking-progress cancelled" : "tracking-progress";

  return `
    <div class="tracking-progress-wrap">
      <div class="progress-head">
        <strong>Delivery Progress</strong>
        <span>${percentageLabel}</span>
      </div>
      <div class="${progressClass}" style="--progress: ${meta.cancelled ? 100 : meta.percent}%;">
        <span></span>
      </div>
      <ul class="tracking-points">${points}</ul>
    </div>
  `;
}

function renderTracking(tracking) {
  const eventsHtml = (tracking.events || [])
    .map((event) => {
      const icon = event.status === "Cancelled" ? "fa-circle-xmark" : "fa-circle-check";
      return `<li><i class="fa-solid ${icon}"></i> ${statusBadge(event.status)}<br><small>${event.message}</small><br><small>${new Date(event.time).toLocaleString()}</small></li>`;
    })
    .join("");

  trackingDetails.innerHTML = `
    <h4><i class="fa-solid fa-box"></i> Order ${tracking.order_id}</h4>
    <p><strong>Tracking ID:</strong> ${tracking.tracking_id || "-"}</p>
    <p><strong>Status:</strong> ${statusBadge(tracking.status)}</p>
    <p><strong>Estimated Delivery:</strong> ${tracking.estimated_delivery}</p>
    ${renderProgress(tracking.status)}
    <ul class="timeline">${eventsHtml || "<li>No events yet.</li>"}</ul>
  `;
}

async function loadOrders() {
  try {
    const data = await api("/orders");
    const orders = data.orders || [];

    if (!orders.length) {
      trackingDetails.innerHTML = "<p>No orders yet. Place an order from the shop first.</p>";
      return;
    }

    orderSelect.innerHTML = '<option value="">Choose an order</option>';
    orders.forEach((order) => {
      const option = document.createElement("option");
      option.value = order._id;
      option.textContent = `${order._id.slice(-8)} • ${order.status}`;
      orderSelect.appendChild(option);
    });

    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("orderId");
    if (orderId && orders.some((order) => order._id === orderId)) {
      orderSelect.value = orderId;
      await loadTracking(orderId);
    }
  } catch (error) {
    trackingDetails.innerHTML = "<p>Login required to track orders.</p>";
    showToast(error.message || "Unable to load orders");
  }
}

async function loadTracking(orderId) {
  if (!orderId) return;
  trackingDetails.innerHTML = "<p><i class='fa-solid fa-spinner fa-spin'></i> Loading tracking...</p>";
  try {
    const response = await api(`/orders/${orderId}/track`);
    renderTracking(response.tracking);
  } catch (error) {
    showToast(error.message || "Unable to load tracking");
  }
}

orderSelect.addEventListener("change", async () => {
  await loadTracking(orderSelect.value);
});

loadOrders();
