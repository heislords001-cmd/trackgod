let miniMap, miniMarker;
let lastTrackingData = null;

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function statusChipClass(status) {
    if (status === 'Delivered') return 'delivered';
    if (status === 'Delayed') return 'delayed';
    return '';
}

function stepIndex(status) {
    if (status === 'Delivered') return 2;
    if (status === 'In Transit' || status === 'Delayed') return 1;
    return 0;
}

function pulseIcon() {
    return L.divIcon({
        className: '',
        html: '<div class="pulse-marker"><div class="ring"></div><div class="dot"></div></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
    });
}

async function trackShipment() {
    const input = document.getElementById('trackingInput');
    const number = input.value.trim();
    const notice = document.getElementById('notice');
    const cardWrap = document.getElementById('cardWrap');

    notice.classList.remove('active');
    cardWrap.classList.remove('active');

    if (!number) {
        notice.textContent = 'Enter a tracking number first.';
        notice.classList.add('active');
        return;
    }

    try {
        const res = await fetch('/api/track/' + encodeURIComponent(number));
        const data = await res.json();
        if (!res.ok) {
            notice.textContent = data.error || 'Tracking number not found.';
            notice.classList.add('active');
            return;
        }
        lastTrackingData = data;
        renderCard(data);
        cardWrap.classList.add('active');
    } catch (e) {
        notice.textContent = 'Something went wrong. Please try again.';
        notice.classList.add('active');
    }
}

function renderCard(data) {
    document.getElementById('cardTrackingNumber').textContent = data.tracking_number;
    document.getElementById('routeValue').textContent = data.route_name;

    const chip = document.getElementById('statusChip');
    chip.textContent = data.status;
    chip.className = 'status-chip ' + statusChipClass(data.status);

    if (data.product_name) {
        document.getElementById('productValue').textContent = data.product_name;
        document.getElementById('productRow').style.display = 'flex';
    } else {
        document.getElementById('productRow').style.display = 'none';
    }

    document.getElementById('updateValue').textContent = new Date(data.last_update).toLocaleString();

    const progress = data.progress || 0;
    document.getElementById('progressValue').textContent = progress + '%';
    document.getElementById('progressFill').style.width = progress + '%';

    const dots = document.getElementById('stepDots');
    const active = stepIndex(data.status);
    dots.innerHTML = [0, 1, 2].map(i => `<div class="step-dot ${i === active ? 'active' : ''}"></div>`).join('');

    document.getElementById('fullMapLink').href = '/map.html?number=' + encodeURIComponent(data.tracking_number);
    document.getElementById('miniMapFrame').onclick = () => {
        window.location.href = '/map.html?number=' + encodeURIComponent(data.tracking_number);
    };

    renderMiniMap(data);
}

function renderMiniMap(data) {
    const startLat = data.start_lat, startLng = data.start_lng;
    const endLat = data.end_lat, endLng = data.end_lng;
    const progress = data.progress || 0;
    const currentLat = startLat + (endLat - startLat) * (progress / 100);
    const currentLng = startLng + (endLng - startLng) * (progress / 100);

    if (!miniMap) {
        miniMap = L.map('miniMap', {
            zoomControl: false,
            dragging: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
            touchZoom: false,
            attributionControl: false
        }).setView([currentLat, currentLng], 4);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(miniMap);
    } else {
        miniMap.setView([currentLat, currentLng], 4);
    }

    if (miniMarker) miniMap.removeLayer(miniMarker);
    miniMarker = L.marker([currentLat, currentLng], { icon: pulseIcon(), interactive: false }).addTo(miniMap);
    setTimeout(() => miniMap.invalidateSize(), 50);
}

document.getElementById('trackingInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') trackShipment();
});
