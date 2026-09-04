function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function pulseIcon() {
    return L.divIcon({
        className: '',
        html: '<div class="pulse-marker"><div class="ring"></div><div class="dot"></div></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
    });
}

async function loadMap() {
    const params = new URLSearchParams(window.location.search);
    const number = params.get('number');
    const metaNumber = document.getElementById('metaNumber');
    const metaRoute = document.getElementById('metaRoute');
    const statusPills = document.getElementById('statusPills');

    if (!number) {
        metaNumber.textContent = 'No tracking number provided';
        return;
    }

    try {
        const res = await fetch('/api/track/' + encodeURIComponent(number));
        const data = await res.json();
        if (!res.ok) {
            metaNumber.textContent = data.error || 'Tracking number not found';
            return;
        }

        metaNumber.textContent = data.tracking_number;
        metaRoute.textContent = data.route_name;

        const startLat = data.start_lat, startLng = data.start_lng;
        const endLat = data.end_lat, endLng = data.end_lng;
        const progress = data.progress || 0;
        const currentLat = startLat + (endLat - startLat) * (progress / 100);
        const currentLng = startLng + (endLng - startLng) * (progress / 100);

        const map = L.map('fullMap').setView([currentLat, currentLng], 4);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        L.marker([startLat, startLng]).addTo(map).bindPopup('Origin');
        L.marker([endLat, endLng]).addTo(map).bindPopup('Destination');

        const liveMarker = L.marker([currentLat, currentLng], { icon: pulseIcon() }).addTo(map);
        liveMarker.bindPopup(`<b>${escapeHtml(data.tracking_number)}</b><br>${escapeHtml(data.status)} — live location`).openPopup();

        L.polyline([[startLat, startLng], [currentLat, currentLng]], {
            color: '#24406E', weight: 4, opacity: 0.8
        }).addTo(map);
        L.polyline([[currentLat, currentLng], [endLat, endLng]], {
            color: '#B4AD9C', weight: 3, opacity: 0.6, dashArray: '2 8'
        }).addTo(map);

        statusPills.innerHTML = `
            <div class="status-pill-lg"><span class="k">STATUS</span> ${escapeHtml(data.status)}</div>
            <div class="status-pill-lg"><span class="k">PROGRESS</span> ${progress}%</div>
            <div class="status-pill-lg"><span class="k">LAST UPDATE</span> ${new Date(data.last_update).toLocaleString()}</div>
        `;

        // Live-location refresh: re-checks position periodically while this page is open.
        setInterval(async () => {
            try {
                const r = await fetch('/api/track/' + encodeURIComponent(number));
                const d = await r.json();
                if (!r.ok) return;
                const p = d.progress || 0;
                const lat = startLat + (endLat - startLat) * (p / 100);
                const lng = startLng + (endLng - startLng) * (p / 100);
                liveMarker.setLatLng([lat, lng]);
            } catch { /* silent — keep last known position */ }
        }, 15000);

    } catch (e) {
        metaNumber.textContent = 'Something went wrong loading the map.';
    }
}

loadMap();
