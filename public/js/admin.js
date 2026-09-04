const STATUSES = ['Pending', 'In Transit', 'Delivered', 'Delayed'];

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showNotice(el, message, type) {
    el.textContent = message;
    el.className = 'notice active ' + type;
}

async function api(url, options = {}) {
    const res = await fetch(url, options);
    let data = {};
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}

// ---------- Routes ----------
let routesCache = [];

async function loadRoutes() {
    const select = document.getElementById('routeSelect');
    try {
        routesCache = await api('/api/routes');
        if (!routesCache.length) {
            select.innerHTML = '<option value="">No routes yet — add one above</option>';
            return;
        }
        select.innerHTML = routesCache.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    } catch (e) {
        select.innerHTML = '<option value="">Could not load routes</option>';
    }
}

async function addRoute() {
    const notice = document.getElementById('routeNotice');
    const name = document.getElementById('routeName').value.trim();
    const start_lat = document.getElementById('startLat').value.trim();
    const start_lng = document.getElementById('startLng').value.trim();
    const end_lat = document.getElementById('endLat').value.trim();
    const end_lng = document.getElementById('endLng').value.trim();

    if (!name || !start_lat || !start_lng || !end_lat || !end_lng) {
        showNotice(notice, 'Fill in all route fields.', 'error');
        return;
    }

    try {
        await api('/api/routes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, start_lat, start_lng, end_lat, end_lng })
        });
        showNotice(notice, 'Route added.', 'success');
        document.getElementById('routeName').value = '';
        document.getElementById('startLat').value = '';
        document.getElementById('startLng').value = '';
        document.getElementById('endLat').value = '';
        document.getElementById('endLng').value = '';
        loadRoutes();
    } catch (e) {
        showNotice(notice, e.message, 'error');
    }
}

// ---------- Shipments ----------
async function createShipment() {
    const notice = document.getElementById('shipmentNotice');
    const route_id = document.getElementById('routeSelect').value;
    if (!route_id) {
        showNotice(notice, 'Choose a route first.', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('route_id', route_id);
    formData.append('product_name', document.getElementById('productName').value.trim());
    formData.append('country_from', document.getElementById('countryFrom').value.trim());
    formData.append('country_to', document.getElementById('countryTo').value.trim());
    formData.append('recipient_name', document.getElementById('recipientName').value.trim());
    formData.append('recipient_address', document.getElementById('recipientAddress').value.trim());
    const fileInput = document.getElementById('productImage');
    if (fileInput.files[0]) formData.append('product_image', fileInput.files[0]);

    try {
        const data = await api('/api/admin/shipments', { method: 'POST', body: formData });
        showNotice(notice, `Created — tracking number ${data.tracking_number}`, 'success');
        ['productName', 'countryFrom', 'countryTo', 'recipientName', 'recipientAddress'].forEach(id => {
            document.getElementById(id).value = '';
        });
        fileInput.value = '';
        loadShipments();
    } catch (e) {
        showNotice(notice, e.message, 'error');
    }
}

function stampClass(status) {
    switch (status) {
        case 'Delivered': return 'stamp-delivered';
        case 'In Transit': return 'stamp-transit';
        case 'Delayed': return 'stamp-delayed';
        default: return 'stamp-pending';
    }
}

async function loadShipments() {
    const body = document.getElementById('shipmentsBody');
    try {
        const shipments = await api('/api/admin/shipments');
        if (!shipments.length) {
            body.innerHTML = '<tr><td colspan="8" class="empty-state">No shipments yet. Create one above.</td></tr>';
            return;
        }
        body.innerHTML = shipments.map(s => `
            <tr data-number="${escapeHtml(s.tracking_number)}">
                <td class="tcode">${escapeHtml(s.tracking_number)}</td>
                <td>${s.product_image ? `<img src="${escapeHtml(s.product_image)}" alt="">` : '—'}</td>
                <td>${escapeHtml(s.product_name || '—')}</td>
                <td>${escapeHtml(s.route_name)}</td>
                <td>
                    <select class="status-select">
                        ${STATUSES.map(st => `<option value="${st}" ${st === s.status ? 'selected' : ''}>${st}</option>`).join('')}
                    </select>
                </td>
                <td><input type="number" class="progress-input" min="0" max="100" value="${s.progress}" /></td>
                <td class="mono" style="font-size:12px;">${new Date(s.last_update).toLocaleString()}</td>
                <td class="row-actions">
                    <button class="btn btn-ghost btn-sm" onclick="saveShipment('${escapeHtml(s.tracking_number)}', this)">Save</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteShipment('${escapeHtml(s.tracking_number)}')">Delete</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        body.innerHTML = `<tr><td colspan="8" class="empty-state">${escapeHtml(e.message)}</td></tr>`;
    }
}

async function saveShipment(number, btn) {
    const row = btn.closest('tr');
    const status = row.querySelector('.status-select').value;
    const progress = row.querySelector('.progress-input').value;
    try {
        await api(`/api/admin/shipments/${encodeURIComponent(number)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, progress })
        });
        loadShipments();
    } catch (e) {
        alert(e.message);
    }
}

async function deleteShipment(number) {
    if (!confirm(`Delete shipment ${number}? This can't be undone.`)) return;
    try {
        await api(`/api/admin/shipments/${encodeURIComponent(number)}`, { method: 'DELETE' });
        loadShipments();
    } catch (e) {
        alert(e.message);
    }
}

loadRoutes();
loadShipments();
