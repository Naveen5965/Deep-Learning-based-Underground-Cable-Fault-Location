// ======================================================
// BURIED CABLE MONITORING SYSTEM
// ESP32-S3 + Supabase + Leaflet + Chart.js
// ======================================================


// ======================================================
// 1. SUPABASE CONFIGURATION
// ======================================================

const SUPABASE_URL =
    "https://awauazxngkwjikarllui.supabase.co";

const SUPABASE_KEY =
    "sb_publishable_M3t6466_21zA1-X2LTT3KQ_yfwyOx1v";


const supabaseClient =
    window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_KEY
    );


// ======================================================
// 2. SETTINGS
// ======================================================

const DEFAULTS = {
    deviceId: "ESP32-001",
    threshHigh: 75,
    threshMid: 50,
    mapZoom: 15,
    mapStyle: "osm",
    historyRows: 10,
    chartPoints: 20
};

const VALID_MAP_STYLES = ["osm","topo","satellite","terrain","dark","light","cycle"];
const _raw = JSON.parse(localStorage.getItem("bcms_settings") || "{}");
if (_raw.mapStyle && !VALID_MAP_STYLES.includes(_raw.mapStyle)) { _raw.mapStyle = "osm"; localStorage.setItem("bcms_settings", JSON.stringify(_raw)); }
const CFG = { ...DEFAULTS, ..._raw };


// ======================================================
// 3. GLOBAL VARIABLES
// ======================================================

let history = [];

let detectionPath = [];

let marker = null;

let pathLine = null;

let lastTelemetryReading = null;

let lastTelemetryAt = null;

let lastTelemetrySampleAt = null;

let lastTelemetryReceivedAt = null;

let estimatedTelemetryIntervalMs = 10000;

let realtimeConnectionState = "CONNECTING";

const CONTROLLER_OFFLINE_THRESHOLD_MS = 30000;

const CONTROLLER_REFRESH_INTERVAL_MS = 500;


// ======================================================
// 4. MAP INITIALIZATION
// ======================================================

const TILE_LAYERS = {
    osm:       { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",                                                attr: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",  filter: "",                                                         sub: "abc" },
    topo:      { url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",                                                  attr: "&copy; OpenStreetMap contributors, &copy; OpenTopoMap",                                    filter: "",                                                         sub: "abc" },
    satellite: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",     attr: "Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA",                                         filter: "",                                                         sub: "" },
    terrain:   { url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",                                             attr: "&copy; OpenStreetMap contributors, Tiles &copy; HOT",                                      filter: "",                                                         sub: "abc" },
    dark:      { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",                                                attr: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",  filter: "invert(1) hue-rotate(180deg) brightness(0.85) saturate(0.6)",  sub: "abc" },
    light:     { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",                                                attr: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",  filter: "brightness(1.1) saturate(0.8)",                             sub: "abc" },
    cycle:     { url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",                                 attr: "&copy; <a href='https://www.cyclosm.org'>CyclOSM</a>, &copy; OpenStreetMap contributors",   filter: "",                                                         sub: "abc" }
};

const map = L.map("map").setView([19.0760, 72.8777], CFG.mapZoom);

const _tl = TILE_LAYERS[CFG.mapStyle] || TILE_LAYERS.osm;
const _tlOpts = { attribution: _tl.attr, maxZoom: 19 };
if (_tl.sub) _tlOpts.subdomains = _tl.sub;
L.tileLayer(_tl.url, _tlOpts).addTo(map);
document.getElementById("map").style.filter = _tl.filter;


// Current detection marker

marker = L.marker([
    19.0760,
    72.8777
]).addTo(map);


marker.bindPopup(
    "Current detection position"
);


// Detection path

detectionPath = [];


pathLine = L.polyline(
    detectionPath
).addTo(map);


// My Location marker (browser geolocation)

let myLocationMarker = null;

const myLocationIcon = L.divIcon({
    className: "",
    html: `<div style="
        width:16px;height:16px;border-radius:50%;
        background:#a78bfa;
        border:3px solid #fff;
        box-shadow:0 0 0 4px rgba(167,139,250,0.35),0 2px 8px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
});


document.getElementById("locateBtn").addEventListener("click", function () {

    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }

    const btn = this;
    btn.classList.add("locating");
    btn.textContent = "Locating…";

    navigator.geolocation.getCurrentPosition(

        pos => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;

            if (myLocationMarker) {
                myLocationMarker.setLatLng([lat, lng]);
            } else {
                myLocationMarker = L.marker([lat, lng], { icon: myLocationIcon })
                    .addTo(map)
                    .bindPopup("Your location");
            }

            myLocationMarker.openPopup();
            map.setView([lat, lng], 16);

            document.getElementById("myCoords").textContent =
                lat.toFixed(5) + ", " + lng.toFixed(5);
            document.getElementById("myLocationRow").style.display = "flex";

            btn.classList.remove("locating");
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg> My Location`;
        },

        err => {
            btn.classList.remove("locating");
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg> My Location`;
            alert("Could not get your location: " + err.message);
        },

        { enableHighAccuracy: true, timeout: 10000 }
    );
});


// ======================================================
// 5. CHART INITIALIZATION
// ======================================================

const ctx =
    document
        .getElementById("signalChart")
        .getContext("2d");


const signalChart =
    new Chart(
        ctx,
        {
            type: "line",

            data: {

                labels: [],

                datasets: [

                    {
                        label:
                            "Detection Signal",

                        data: [],

                        tension: 0.4,

                        fill: true,

                        borderColor: "#a78bfa",

                        backgroundColor: "rgba(167, 139, 250, 0.08)",

                        pointBackgroundColor: "#a78bfa",

                        pointRadius: 3,

                        pointHoverRadius: 5,

                        borderWidth: 2
                    }

                ]

            },

            options: {

                responsive: true,

                maintainAspectRatio: true,

                plugins: {

                    legend: {
                        labels: {
                            color: "#9aa9bc",
                            font: { family: "Manrope" }
                        }
                    }

                },

                scales: {

                    y: {

                        min: 0,

                        max: 100,

                        grid: {
                            color: "rgba(148, 163, 184, 0.08)"
                        },

                        ticks: { color: "#9aa9bc" },

                        title: {

                            display: true,

                            text: "Signal Strength (%)",

                            color: "#9aa9bc"

                        }

                    },

                    x: {

                        grid: {
                            color: "rgba(148, 163, 184, 0.08)"
                        },

                        ticks: { color: "#9aa9bc" },

                        title: {

                            display: true,

                            text: "Time",

                            color: "#9aa9bc"

                        }

                    }

                }

            }

        }
    );


// ======================================================
// 6. LOAD SENSOR DATA FROM SUPABASE
// ======================================================

async function loadSensorData() {

    console.log(
        "Loading sensor data..."
    );


    const {

        data,

        error

    } = await supabaseClient

        .from("sensor_readings")

        .select("*")

        .order(
            "timestamp",
            {
                ascending: false
            }
        )

        .limit(CFG.chartPoints);


    // Error handling

    if (error) {

        console.error(
            "Supabase error:",
            error
        );

        return;

    }


    // No data

    if (
        !data ||
        data.length === 0
    ) {

        console.log(
            "No sensor data found."
        );

        return;

    }


    console.log(
        "Sensor records loaded:",
        data.length
    );


    // ----------------------------------------------
    // Clear existing history/chart
    // ----------------------------------------------

    history = [];

    detectionPath = [];


    signalChart.data.labels = [];

    signalChart.data.datasets[0].data = [];


    // ----------------------------------------------
    // Process oldest → newest
    // ----------------------------------------------

    const records =
        data
            .slice()
            .reverse();


    records.forEach(
        reading => {

            updateSignalChart(
                reading
            );


            addHistory(
                formatTime(
                    reading.timestamp
                ),

                Number(
                    reading.signal_strength
                ),

                Number(
                    reading.latitude
                ),

                Number(
                    reading.longitude
                ),

                reading.detection_status
            );


            addMapPoint(
                reading
            );

        }
    );


    // ----------------------------------------------
    // Update dashboard with newest reading
    // ----------------------------------------------

    updateDashboard(
        data[0]
    );


    // ----------------------------------------------
    // Update chart once
    // ----------------------------------------------

    signalChart.update();


    console.log(
        "Initial dashboard loaded."
    );
}


// ======================================================
// 7. UPDATE DASHBOARD
// ======================================================

function updateDashboard(
    reading,
    receivedAt = null
) {

    if (!reading) {

        return;

    }


    lastTelemetryReading = reading;

    const sampleTimestamp =
        parseTimestamp(
            reading.timestamp
        );


    if (sampleTimestamp) {

        lastTelemetrySampleAt =
            sampleTimestamp;

    }


    if (receivedAt) {

        if (lastTelemetryReceivedAt) {

            const telemetryGapMs =
                receivedAt - lastTelemetryReceivedAt;


            if (
                telemetryGapMs > 0
                && telemetryGapMs < 60000
            ) {

                estimatedTelemetryIntervalMs =
                    Math.round(
                        (estimatedTelemetryIntervalMs * 0.8)
                        + (telemetryGapMs * 0.2)
                    );

            }

        }


        lastTelemetryReceivedAt =
            receivedAt;


        lastTelemetryAt =
            receivedAt;

    } else if (sampleTimestamp) {

        lastTelemetryAt =
            sampleTimestamp;

    }


    if (!lastTelemetryAt) {

        lastTelemetryAt =
            Date.now();

    }


    // ----------------------------------------------
    // DEVICE
    // ----------------------------------------------

    document
        .getElementById("device")
        .textContent =
        reading.device_id ||
        "UNKNOWN";


    document
        .getElementById("deviceStatusText")
        .textContent =
        "Connected";


    // ----------------------------------------------
    // DETECTION STATUS
    // ----------------------------------------------

    const status =
        reading.detection_status ||
        "UNKNOWN";


    document
        .getElementById("detection")
        .textContent =
        status;


    // ----------------------------------------------
    // SIGNAL
    // ----------------------------------------------

    const signalValue =
        Number(
            reading.signal_strength
        );


    const safeSignal =
        Number.isFinite(
            signalValue
        )
            ? Math.max(
                0,
                Math.min(
                    100,
                    signalValue
                )
            )
            : 0;


    document
        .getElementById("signal")
        .textContent =
        safeSignal.toFixed(0) +
        "%";


    // Signal bar

    document
        .getElementById("signalFill")
        .style.width =
        safeSignal + "%";


    // ----------------------------------------------
    // MAGNETIC X
    // ----------------------------------------------

    document
        .getElementById("magX")
        .textContent =
        reading.magnetic_x ??
        "--";


    // ----------------------------------------------
    // MAGNETIC Y
    // ----------------------------------------------

    document
        .getElementById("magY")
        .textContent =
        reading.magnetic_y ??
        "--";


    // ----------------------------------------------
    // MAGNETIC Z
    // ----------------------------------------------

    document
        .getElementById("magZ")
        .textContent =
        reading.magnetic_z ??
        "--";


    // ----------------------------------------------
    // GPS
    // ----------------------------------------------

    const latitude =
        Number(
            reading.latitude
        );


    const longitude =
        Number(
            reading.longitude
        );


    if (

        Number.isFinite(
            latitude
        )

        &&

        Number.isFinite(
            longitude
        )

    ) {

        document
            .getElementById("gps")
            .textContent =
            "FIXED";


        const position = [
            latitude,
            longitude
        ];


        // Move marker

        marker.setLatLng(
            position
        );


        // Move map

        map.setView(
            position,
            CFG.mapZoom
        );


        // Update device coords display

        const coordsEl = document.getElementById("deviceCoords");
        if (coordsEl) coordsEl.textContent = latitude.toFixed(5) + ", " + longitude.toFixed(5);

    } else {

        document
            .getElementById("gps")
            .textContent =
            "NO FIX";


        refreshControllerStatus();

    }

}


// ======================================================
// 8. ADD MAP POINT
// ======================================================

function addMapPoint(
    reading
) {

    const latitude =
        Number(
            reading.latitude
        );


    const longitude =
        Number(
            reading.longitude
        );


    if (

        !Number.isFinite(
            latitude
        )

        ||

        !Number.isFinite(
            longitude
        )

    ) {

        return;

    }


    const position = [
        latitude,
        longitude
    ];


    detectionPath.push(
        position
    );


    pathLine.setLatLngs(
        detectionPath
    );


    marker.setLatLng(
        position
    );

}


// ======================================================
// 9. UPDATE SIGNAL CHART
// ======================================================

function updateSignalChart(
    reading
) {

    const signal =
        Number(
            reading.signal_strength
        );


    if (
        !Number.isFinite(
            signal
        )
    ) {

        return;

    }


    const time =
        formatTime(
            reading.timestamp
        );


    signalChart.data.labels.push(
        time
    );


    signalChart
        .data
        .datasets[0]
        .data
        .push(
            signal
        );


    // Maximum CFG.chartPoints points

    if (
        signalChart
            .data
            .labels
            .length > CFG.chartPoints
    ) {

        signalChart
            .data
            .labels
            .shift();


        signalChart
            .data
            .datasets[0]
            .data
            .shift();

    }

}


// ======================================================
// 10. HISTORY TABLE
// ======================================================

function addHistory(

    time,

    signal,

    latitude,

    longitude,

    status

) {

    history.unshift({

        time:
            time,

        signal:
            Number(signal),

        latitude:
            latitude,

        longitude:
            longitude,

        status:
            status ||
            "UNKNOWN"

    });


    // Maximum CFG.historyRows rows

    if (
        history.length > CFG.historyRows
    ) {

        history.pop();

    }


    renderHistory();

}


// ======================================================
// 11. RENDER HISTORY TABLE
// ======================================================

function renderHistory() {

    const table =
        document.getElementById(
            "history"
        );


    table.innerHTML = "";


    history.forEach(
        row => {

            const signal =
                Number(
                    row.signal
                );


            const latitude =
                Number(
                    row.latitude
                );


            const longitude =
                Number(
                    row.longitude
                );


            table.innerHTML += `<tr>
                <td data-label="Time">${row.time}</td>
                <td data-label="Signal">${Number.isFinite(signal) ? signal.toFixed(0) + "%" : "--"}</td>
                <td data-label="Latitude">${Number.isFinite(latitude) ? latitude.toFixed(4) : "--"}</td>
                <td data-label="Longitude">${Number.isFinite(longitude) ? longitude.toFixed(4) : "--"}</td>
                <td data-label="Status">${statusBadge(row.status)}</td>
            </tr>`;

        }
    );

}


function statusBadge(status) {
    const s = String(status || "").toUpperCase();
    if (s === "DETECTED" || s === "CABLE DETECTED") return `<span class="badge badge-detected">${s}</span>`;
    if (s === "NOT DETECTED" || s === "NOT_DETECTED" || s === "NO CABLE") return `<span class="badge badge-not-detected">${s}</span>`;
    if (s === "POSSIBLE CABLE" || s === "POSSIBLE") return `<span class="badge badge-unknown">${s}</span>`;
    return `<span class="badge badge-unknown">${s || "UNKNOWN"}</span>`;
}


// ======================================================
// 12. REALTIME CONNECTION
// ======================================================

function startRealtime() {

    console.log(
        "Starting Supabase Realtime..."
    );


    supabaseClient

        .channel(
            "sensor-readings-channel"
        )

        .on(

            "postgres_changes",

            {

                event:
                    "INSERT",

                schema:
                    "public",

                table:
                    "sensor_readings"

            },

            payload => {

                console.log(
                    "NEW SENSOR DATA:",
                    payload.new
                );


                const reading =
                    payload.new;


                if (isPaused) return;


                // Update cards

                updateDashboard(
                    reading,
                    Date.now()
                );


                // Update graph

                updateSignalChart(
                    reading
                );


                signalChart.update();


                // Update history

                addHistory(

                    formatTime(
                        reading.timestamp
                    ),

                    Number(
                        reading.signal_strength
                    ),

                    Number(
                        reading.latitude
                    ),

                    Number(
                        reading.longitude
                    ),

                    reading.detection_status

                );


                // Update map

                addMapPoint(
                    reading
                );


                // Update map timestamp

                const mapMeta = document.getElementById("mapLastUpdated");
                if (mapMeta) mapMeta.textContent = `Updated ${new Date().toLocaleTimeString()}`;

            }

        )

        .subscribe(
            status => {

                realtimeConnectionState = status;


                console.log(
                    "Realtime status:",
                    status
                );


                refreshControllerStatus();

            }
        );

}


// ======================================================
// 13. CONTROLLER STATUS
// ======================================================

function refreshControllerStatus() {

    const reading =
        lastTelemetryReading;


    const controllerBadge =
        document.getElementById(
            "controllerBadge"
        );


    const controllerDot =
        document.getElementById(
            "controllerDot"
        );


    const controllerBadgeText =
        document.getElementById(
            "controllerBadgeText"
        );


    const controllerStatusHint =
        document.getElementById(
            "controllerStatusHint"
        );


    const wifiStatusText =
        document.getElementById(
            "wifiStatusText"
        );


    const controllerStatusText =
        document.getElementById(
            "controllerStatusText"
        );


    const gpsStatusText =
        document.getElementById(
            "gpsStatusText"
        );


    const cloudStatusText =
        document.getElementById(
            "cloudStatusText"
        );


    const deviceElement =
        document.getElementById(
            "device"
        );


    const deviceStatusText =
        document.getElementById(
            "deviceStatusText"
        );


    const deviceId =
        reading?.device_id ||
        CFG.deviceId;


    const controllerStatus =
        normalizeControllerStatus(
            reading
        );


    const isOffline =
        controllerStatus.tone === "offline";


    const isWarning =
        controllerStatus.tone === "warning";


    document.body.classList.toggle(
        "is-offline",
        isOffline
    );


    document.body.classList.toggle(
        "is-warning",
        isWarning
    );


    const statusText =
        controllerStatus.label;


    if (controllerBadge) {

        controllerBadge.classList.remove(
            "online",
            "warning",
            "offline"
        );

        controllerBadge.classList.add(
            controllerStatus.tone
        );


        controllerBadge.setAttribute(
            "aria-label",
            `Controller status ${controllerStatus.label}`
        );

    }


    if (controllerDot) {

        controllerDot.className =
            controllerStatus.tone;

    }


    if (controllerBadgeText) {

        controllerBadgeText.textContent =
            `CONTROLLER ${statusText}`;

    }


    if (controllerStatusHint) {

        controllerStatusHint.textContent =
            controllerStatus.detail ||
            `${deviceId} telemetry received`;

    }


    if (deviceElement) {

        deviceElement.textContent =
            deviceId;

    }


    if (deviceStatusText) {

        deviceStatusText.textContent =
            controllerStatus.tone === "offline"
                ? "Disconnected"
                : controllerStatus.tone === "warning"
                    ? "Connecting"
                    : "Connected";

        deviceStatusText.style.color =
            controllerStatus.tone === "offline"
                ? "#ef4444"
                : controllerStatus.tone === "warning"
                    ? "#f59e0b"
                    : "#9fb0c5";

    }


    if (wifiStatusText) {

        const wifiStatus =
            normalizeWifiStatus(
                reading,
                controllerStatus
            );

        wifiStatusText.className =
            wifiStatus.tone;


        wifiStatusText.textContent =
            wifiStatus.label;

    }


    if (controllerStatusText) {

        controllerStatusText.className =
            controllerStatus.tone;


        controllerStatusText.textContent =
            controllerStatus.label;

    }


    if (gpsStatusText) {

        gpsStatusText.className =
            controllerStatus.tone === "offline"
                ? "warning"
                : "online";


        gpsStatusText.textContent =
            reading?.gps_status ||
            reading?.gps_state ||
            (document.getElementById("gps")?.textContent || "FIXED");

    }


    if (cloudStatusText) {

        const cloudStatus =
            normalizeCloudStatus(
                reading,
                controllerStatus
            );

        cloudStatusText.className =
            cloudStatus.tone;


        cloudStatusText.textContent =
            cloudStatus.label;

    }

}


function normalizeControllerStatus(
    reading
) {

    const controllerValue =
        String(
            reading?.controller_status ||
            reading?.controllerState ||
            ""
        ).trim().toUpperCase();


    if (controllerValue) {

        if (
            [
                "ONLINE",
                "CONNECTED",
                "UP"
            ].includes(
                controllerValue
            )
        ) {
            return {
                label: "ONLINE",
                tone: "online",
                detail: controllerStatusDetail(
                    reading,
                    "Controller telemetry active"
                )
            };
        }


        if (
            [
                "WARNING",
                "DEGRADED",
                "LOST_SIGNAL"
            ].includes(
                controllerValue
            )
        ) {
            return {
                label: "DEGRADED",
                tone: "warning",
                detail: controllerStatusDetail(
                    reading,
                    "Controller signal degraded"
                )
            };
        }


        return {
            label: "OFFLINE",
            tone: "offline",
            detail: controllerStatusDetail(
                reading,
                "Controller reported offline"
            )
        };

    }


    const telemetryAgeMs =
        lastTelemetryAt
            ? Date.now() - lastTelemetryAt
            : Number.POSITIVE_INFINITY;


    const offlineThresholdMs =
        Math.max(
            CONTROLLER_OFFLINE_THRESHOLD_MS,
            estimatedTelemetryIntervalMs * 3
        );


    if (!lastTelemetryAt) {

        return {
            label: "CONNECTING",
            tone: "warning",
            detail: controllerStatusDetail(
                reading,
                "Waiting for first telemetry packet"
            )
        };

    }


    const realtimeIsConnected =
        realtimeConnectionState === "SUBSCRIBED";


    if (
        telemetryAgeMs >
        offlineThresholdMs
    ) {
        return {
            label: "OFFLINE",
            tone: "offline",
            detail: controllerStatusDetail(
                reading,
                `No telemetry for ${formatDuration(telemetryAgeMs)}`
            )
        };
    }


    if (!realtimeIsConnected) {
        return {
            label: "CONNECTING",
            tone: "warning",
            detail: controllerStatusDetail(
                reading,
                "Waiting for realtime subscription"
            )
        };
    }


    return {
        label: "ONLINE",
        tone: "online",
        detail: controllerStatusDetail(
            reading,
            `Last telemetry ${formatDuration(telemetryAgeMs)} ago`
        )
    };

}


function normalizeWifiStatus(
    reading,
    controllerStatus
) {

    if (controllerStatus?.tone === "offline") {
        return {
            label: "DISCONNECTED",
            tone: "offline"
        };
    }

    const wifiValue =
        String(
            reading?.wifi_status ||
            reading?.wifi_state ||
            ""
        ).trim().toUpperCase();


    if (wifiValue) {

        if (
            [
                "CONNECTED",
                "ONLINE",
                "UP",
                "OK"
            ].includes(
                wifiValue
            )
        ) {
            return {
                label: "CONNECTED",
                tone: "online"
            };
        }


        if (
            [
                "CONNECTING",
                "RECONNECTING",
                "DEGRADED"
            ].includes(
                wifiValue
            )
        ) {
            return {
                label: "CONNECTING",
                tone: "warning"
            };
        }


        return {
            label: "DISCONNECTED",
            tone: "offline"
        };

    }


    if (controllerStatus?.tone === "warning") {
        return {
            label: "CONNECTING",
            tone: "warning"
        };
    }


    return {
        label: "CONNECTED",
        tone: "online"
    };

}


function normalizeCloudStatus(
    reading,
    controllerStatus
) {

    if (
        realtimeConnectionState === "CHANNEL_ERROR"
        || realtimeConnectionState === "TIMED_OUT"
        || realtimeConnectionState === "CLOSED"
    ) {
        return {
            label: "DISCONNECTED",
            tone: "offline"
        };
    }


    if (realtimeConnectionState !== "SUBSCRIBED") {
        return {
            label: "CONNECTING",
            tone: "warning"
        };
    }


    const cloudValue =
        String(
            reading?.cloud_status ||
            reading?.cloud_state ||
            ""
        ).trim().toUpperCase();


    if (cloudValue) {

        if (
            [
                "CONNECTED",
                "ONLINE",
                "UP",
                "OK"
            ].includes(
                cloudValue
            )
        ) {
            return {
                label: "CONNECTED",
                tone: "online"
            };
        }


        if (
            [
                "CONNECTING",
                "RECONNECTING",
                "SYNCING",
                "DEGRADED"
            ].includes(
                cloudValue
            )
        ) {
            return {
                label: "CONNECTING",
                tone: "warning"
            };
        }


        return {
            label: "DISCONNECTED",
            tone: "offline"
        };

    }


    return {
        label: "CONNECTED",
        tone: "online"
    };

}


function controllerStatusDetail(
    reading,
    fallbackMessage
) {

    const deviceId =
        reading?.device_id ||
        CFG.deviceId;


    return `${deviceId} • ${fallbackMessage}`;

}


function formatDuration(
    durationMs
) {

    if (
        !Number.isFinite(durationMs)
    ) {
        return "unknown";
    }


    if (durationMs < 1000) {
        return "just now";
    }


    const totalSeconds =
        Math.floor(
            durationMs / 1000
        );


    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }


    const totalMinutes =
        Math.floor(
            totalSeconds / 60
        );


    if (totalMinutes < 60) {
        return `${totalMinutes}m`;
    }


    const totalHours =
        Math.floor(
            totalMinutes / 60
        );


    return `${totalHours}h`;

}


function parseTimestamp(
    timestamp
) {

    if (!timestamp) {
        return null;
    }


    const parsed =
        new Date(
            timestamp
        ).getTime();


    return Number.isFinite(parsed)
        ? parsed
        : null;

}


setInterval(
    refreshControllerStatus,
    CONTROLLER_REFRESH_INTERVAL_MS
);


// ======================================================
// 14. TIME FORMATTER
// ======================================================

function formatTime(
    timestamp
) {

    if (!timestamp) {

        return "--";

    }


    return new Date(
        timestamp
    ).toLocaleTimeString();

}


// ======================================================
// 15. START APPLICATION
// ======================================================

console.log(
    "Buried Cable Monitoring Dashboard starting..."
);


loadSensorData();


startRealtime();


refreshControllerStatus();


// ======================================================
// 16. DEVICE POWER CONTROL
// ======================================================

let devicePowerState = "ON";
let isPaused = false;

const powerBtn = document.getElementById("powerBtn");
const powerBtnText = document.getElementById("powerBtnText");

const POWER_SVG = `<svg class="power-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`;


function applyPowerState(state) {
    devicePowerState = state;
    isPaused = state === "OFF";

    if (state === "OFF") {
        powerBtn.classList.add("is-off");
        powerBtnText.textContent = "TURN ON";
        document.body.classList.add("device-off");
    } else {
        powerBtn.classList.remove("is-off");
        powerBtnText.textContent = "TURN OFF";
        document.body.classList.remove("device-off");
    }
}


async function loadPowerState() {
    const deviceId = lastTelemetryReading?.device_id || CFG.deviceId;

    const { data, error } = await supabaseClient
        .from("device_control")
        .select("command")
        .eq("device_id", deviceId)
        .maybeSingle();

    if (!error && data) {
        applyPowerState(data.command === "OFF" ? "OFF" : "ON");
    }
}


async function sendPowerCommand(command) {
    const deviceId = lastTelemetryReading?.device_id || CFG.deviceId;

    powerBtn.classList.add("is-sending");

    const { error } = await supabaseClient
        .from("device_control")
        .upsert(
            {
                device_id: deviceId,
                command: command,
                updated_at: new Date().toISOString()
            },
            { onConflict: "device_id" }
        );

    powerBtn.classList.remove("is-sending");

    if (error) {
        console.error("Power command failed:", error);
        alert("Failed to send command: " + error.message);
        return;
    }

    applyPowerState(command);
    console.log("Power command sent:", command);
}


powerBtn.addEventListener("click", () => {
    const next = devicePowerState === "ON" ? "OFF" : "ON";
    sendPowerCommand(next);
});


// Load power state after a short delay to allow first telemetry to set device_id
setTimeout(loadPowerState, 1500);