// webbluetooth-firefox-extension/polyfill.js

if (!navigator.bluetooth) {
    console.log("WebBluetooth API not found, injecting secure polyfill.");

    const STANDARD_GATT_SERVICES = {
        'alert_notification': '00001811-0000-1000-8000-00805f9b34fb',
        'automation_io': '00001815-0000-1000-8000-00805f9b34fb',
        'battery_service': '0000180f-0000-1000-8000-00805f9b34fb',
        'blood_pressure': '00001810-0000-1000-8000-00805f9b34fb',
        'body_composition': '0000181b-0000-1000-8000-00805f9b34fb',
        'bond_management': '0000181e-0000-1000-8000-00805f9b34fb',
        'continuous_glucose_monitoring': '0000181f-0000-1000-8000-00805f9b34fb',
        'current_time': '00001805-0000-1000-8000-00805f9b34fb',
        'cycling_power': '00001818-0000-1000-8000-00805f9b34fb',
        'cycling_speed_and_cadence': '00001816-0000-1000-8000-00805f9b34fb',
        'device_information': '0000180a-0000-1000-8000-00805f9b34fb',
        'environmental_sensing': '0000181a-0000-1000-8000-00805f9b34fb',
        'fitness_machine': '00001826-0000-1000-8000-00805f9b34fb',
        'generic_access': '00001800-0000-1000-8000-00805f9b34fb',
        'generic_attribute': '00001801-0000-1000-8000-00805f9b34fb',
        'glucose': '00001808-0000-1000-8000-00805f9b34fb',
        'health_thermometer': '00001809-0000-1000-8000-00805f9b34fb',
        'heart_rate': '0000180d-0000-1000-8000-00805f9b34fb',
        'human_interface_device': '00001812-0000-1000-8000-00805f9b34fb',
        'immediate_alert': '00001802-0000-1000-8000-00805f9b34fb',
        'indoor_positioning': '00001821-0000-1000-8000-00805f9b34fb',
        'insulin_delivery': '0000183a-0000-1000-8000-00805f9b34fb',
        'internet_protocol_support': '00001820-0000-1000-8000-00805f9b34fb',
        'link_loss': '00001803-0000-1000-8000-00805f9b34fb',
        'location_and_navigation': '00001819-0000-1000-8000-00805f9b34fb',
        'mesh_provisioning': '00001827-0000-1000-8000-00805f9b34fb',
        'mesh_proxy': '00001828-0000-1000-8000-00805f9b34fb',
        'next_dst_change': '00001807-0000-1000-8000-00805f9b34fb',
        'object_transfer': '00001825-0000-1000-8000-00805f9b34fb',
        'phone_alert_status': '0000180e-0000-1000-8000-00805f9b34fb',
        'pulse_oximeter': '00001822-0000-1000-8000-00805f9b34fb',
        'reconnection_configuration': '00001829-0000-1000-8000-00805f9b34fb',
        'reference_time_update': '00001806-0000-1000-8000-00805f9b34fb',
        'running_speed_and_cadence': '00001814-0000-1000-8000-00805f9b34fb',
        'scan_parameters': '00001813-0000-1000-8000-00805f9b34fb',
        'transport_discovery': '00001824-0000-1000-8000-00805f9b34fb',
        'tx_power': '00001804-0000-1000-8000-00805f9b34fb',
        'user_data': '0000181c-0000-1000-8000-00805f9b34fb',
        'weight_scale': '0000181d-0000-1000-8000-00805f9b34fb'
    };
    const STANDARD_GATT_CHARACTERISTICS = {
        'aerobic_threshold': '00002a7f-0000-1000-8000-00805f9b34fb',
        'age': '00002a80-0000-1000-8000-00805f9b34fb',
        'aggregate': '00002a5a-0000-1000-8000-00805f9b34fb',
        'alert_category_id': '00002a43-0000-1000-8000-00805f9b34fb',
        'alert_category_id_bit_mask': '00002a42-0000-1000-8000-00805f9b34fb',
        'alert_level': '00002a06-0000-1000-8000-00805f9b34fb',
        'alert_notification_control_point': '00002a44-0000-1000-8000-00805f9b34fb',
        'alert_status': '00002a3f-0000-1000-8000-00805f9b34fb',
        'altitude': '00002ab3-0000-1000-8000-00805f9b34fb',
        'anaerobic_threshold': '00002a7c-0000-1000-8000-00805f9b34fb',
        'analog': '00002a58-0000-1000-8000-00805f9b34fb',
        'apparent_wind_direction': '00002a73-0000-1000-8000-00805f9b34fb',
        'apparent_wind_speed': '00002a72-0000-1000-8000-00805f9b34fb',
        'appearance': '00002a01-0000-1000-8000-00805f9b34fb',
        'barometric_pressure_trend': '00002aa3-0000-1000-8000-00805f9b34fb',
        'battery_level': '00002a19-0000-1000-8000-00805f9b34fb',
        'blood_pressure_feature': '00002a49-0000-1000-8000-00805f9b34fb',
        'blood_pressure_measurement': '00002a35-0000-1000-8000-00805f9b34fb',
        'body_composition_feature': '00002a9b-0000-1000-8000-00805f9b34fb',
        'body_composition_measurement': '00002a9c-0000-1000-8000-00805f9b34fb',
        'body_sensor_location': '00002a38-0000-1000-8000-00805f9b34fb',
        'boot_keyboard_input_report': '00002a22-0000-1000-8000-00805f9b34fb',
        'boot_keyboard_output_report': '00002a32-0000-1000-8000-00805f9b34fb',
        'boot_mouse_input_report': '00002a33-0000-1000-8000-00805f9b34fb',
        'csc_feature': '00002a5c-0000-1000-8000-00805f9b34fb',
        'csc_measurement': '00002a5b-0000-1000-8000-00805f9b34fb',
        'current_time': '00002a2b-0000-1000-8000-00805f9b34fb',
        'cycling_power_control_point': '00002a66-0000-1000-8000-00805f9b34fb',
        'cycling_power_feature': '00002a65-0000-1000-8000-00805f9b34fb',
        'cycling_power_measurement': '00002a63-0000-1000-8000-00805f9b34fb',
        'cycling_power_vector': '00002a64-0000-1000-8000-00805f9b34fb',
        'database_change_increment': '00002a99-0000-1000-8000-00805f9b34fb',
        'date_of_birth': '00002a85-0000-1000-8000-00805f9b34fb',
        'date_of_threshold_assessment': '00002a86-0000-1000-8000-00805f9b34fb',
        'date_time': '00002a08-0000-1000-8000-00805f9b34fb',
        'day_date_time': '00002a0a-0000-1000-8000-00805f9b34fb',
        'day_of_week': '00002a09-0000-1000-8000-00805f9b34fb',
        'descriptor_value_changed': '00002a7d-0000-1000-8000-00805f9b34fb',
        'device_name': '00002a00-0000-1000-8000-00805f9b34fb',
        'dew_point': '00002a7b-0000-1000-8000-00805f9b34fb',
        'digital': '00002a56-0000-1000-8000-00805f9b34fb',
        'dst_offset': '00002a0d-0000-1000-8000-00805f9b34fb',
        'elevation': '00002a6c-0000-1000-8000-00805f9b34fb',
        'email_address': '00002a87-0000-1000-8000-00805f9b34fb',
        'exact_time_256': '00002a0c-0000-1000-8000-00805f9b34fb',
        'fat_burn_heart_rate_lower_limit': '00002a88-0000-1000-8000-00805f9b34fb',
        'fat_burn_heart_rate_upper_limit': '00002a89-0000-1000-8000-00805f9b34fb',
        'firmware_revision_string': '00002a26-0000-1000-8000-00805f9b34fb',
        'first_name': '00002a8a-0000-1000-8000-00805f9b34fb',
        'five_zone_heart_rate_limits': '00002a8b-0000-1000-8000-00805f9b34fb',
        'floor_number': '00002ab2-0000-1000-8000-00805f9b34fb',
        'gender': '00002a8c-0000-1000-8000-00805f9b34fb',
        'glucose_feature': '00002a51-0000-1000-8000-00805f9b34fb',
        'glucose_measurement': '00002a18-0000-1000-8000-00805f9b34fb',
        'gust_factor': '00002a74-0000-1000-8000-00805f9b34fb',
        'hardware_revision_string': '00002a27-0000-1000-8000-00805f9b34fb',
        'heart_rate_control_point': '00002a39-0000-1000-8000-00805f9b34fb',
        'heart_rate_max': '00002a8d-0000-1000-8000-00805f9b34fb',
        'heart_rate_measurement': '00002a37-0000-1000-8000-00805f9b34fb',
        'heat_index': '00002a7a-0000-1000-8000-00805f9b34fb',
        'height': '00002a8e-0000-1000-8000-00805f9b34fb',
        'hid_control_point': '00002a4c-0000-1000-8000-00805f9b34fb',
        'hid_information': '00002a4a-0000-1000-8000-00805f9b34fb',
        'hip_circumference': '00002a8f-0000-1000-8000-00805f9b34fb',
        'humidity': '00002a6f-0000-1000-8000-00805f9b34fb',
        'ieee_11073-20601_regulatory_certification_data_list': '00002a2a-0000-1000-8000-00805f9b34fb',
        'indoor_bike_data': '00002ad2-0000-1000-8000-00805f9b34fb',
        'intermediate_cuff_pressure': '00002a36-0000-1000-8000-00805f9b34fb',
        'intermediate_temperature': '00002a1e-0000-1000-8000-00805f9b34fb',
        'irradiance': '00002a77-0000-1000-8000-00805f9b34fb',
        'language': '00002aa2-0000-1000-8000-00805f9b34fb',
        'last_name': '00002a90-0000-1000-8000-00805f9b34fb',
        'latitude': '00002aae-0000-1000-8000-00805f9b34fb',
        'ln_control_point': '00002a6b-0000-1000-8000-00805f9b34fb',
        'ln_feature': '00002a6a-0000-1000-8000-00805f9b34fb',
        'local_east_coordinate': '00002ab1-0000-1000-8000-00805f9b34fb',
        'local_north_coordinate': '00002ab0-0000-1000-8000-00805f9b34fb',
        'local_time_information': '00002a0f-0000-1000-8000-00805f9b34fb',
        'location_and_speed': '00002a67-0000-1000-8000-00805f9b34fb',
        'location_name': '00002ab5-0000-1000-8000-00805f9b34fb',
        'longitude': '00002aaf-0000-1000-8000-00805f9b34fb',
        'magnetic_declination': '00002aa2-0000-1000-8000-00805f9b34fb',
        'magnetic_flux_density_2d': '00002aa0-0000-1000-8000-00805f9b34fb',
        'magnetic_flux_density_3d': '00002aa1-0000-1000-8000-00805f9b34fb',
        'manufacturer_name_string': '00002a29-0000-1000-8000-00805f9b34fb',
        'maximum_recommended_heart_rate': '00002a91-0000-1000-8000-00805f9b34fb',
        'measurement_interval': '00002a21-0000-1000-8000-00805f9b34fb',
        'model_number_string': '00002a24-0000-1000-8000-00805f9b34fb',
        'navigation': '00002a68-0000-1000-8000-00805f9b34fb',
        'network_availability': '00002a3e-0000-1000-8000-00805f9b34fb',
        'new_alert': '00002a46-0000-1000-8000-00805f9b34fb',
        'object_action_control_point': '00002ac5-0000-1000-8000-00805f9b34fb',
        'object_changed': '00002ac8-0000-1000-8000-00805f9b34fb',
        'object_first_created': '00002ac1-0000-1000-8000-00805f9b34fb',
        'object_id': '00002ac3-0000-1000-8000-00805f9b34fb',
        'object_last_modified': '00002ac2-0000-1000-8000-00805f9b34fb',
        'object_list_control_point': '00002ac6-0000-1000-8000-00805f9b34fb',
        'object_list_filter': '00002ac7-0000-1000-8000-00805f9b34fb',
        'object_name': '00002abe-0000-1000-8000-00805f9b34fb',
        'object_properties': '00002ac4-0000-1000-8000-00805f9b34fb',
        'object_size': '00002ac0-0000-1000-8000-00805f9b34fb',
        'object_type': '00002abf-0000-1000-8000-00805f9b34fb',
        'pnp_id': '00002a50-0000-1000-8000-00805f9b34fb',
        'pollen_concentration': '00002a75-0000-1000-8000-00805f9b34fb',
        'position_quality': '00002a69-0000-1000-8000-00805f9b34fb',
        'pressure': '00002a6d-0000-1000-8000-00805f9b34fb',
        'protocol_mode': '00002a4e-0000-1000-8000-00805f9b34fb',
        'rainfall': '00002a78-0000-1000-8000-00805f9b34fb',
        'reconnection_address': '00002a03-0000-1000-8000-00805f9b34fb',
        'record_access_control_point': '00002a52-0000-1000-8000-00805f9b34fb',
        'reference_time_information': '00002a14-0000-1000-8000-00805f9b34fb',
        'resting_heart_rate': '00002a92-0000-1000-8000-00805f9b34fb',
        'ringer_control_point': '00002a40-0000-1000-8000-00805f9b34fb',
        'ringer_setting': '00002a41-0000-1000-8000-00805f9b34fb',
        'rsc_feature': '00002a54-0000-1000-8000-00805f9b34fb',
        'rsc_measurement': '00002a53-0000-1000-8000-00805f9b34fb',
        'sc_control_point': '00002a55-0000-1000-8000-00805f9b34fb',
        'scan_interval_window': '00002a4f-0000-1000-8000-00805f9b34fb',
        'scan_refresh': '00002a31-0000-1000-8000-00805f9b34fb',
        'sensor_location': '00002a5d-0000-1000-8000-00805f9b34fb',
        'serial_number_string': '00002a25-0000-1000-8000-00805f9b34fb',
        'service_required': '00002a3b-0000-1000-8000-00805f9b34fb',
        'software_revision_string': '00002a28-0000-1000-8000-00805f9b34fb',
        'sport_type_for_aerobic_and_anaerobic_thresholds': '00002a93-0000-1000-8000-00805f9b34fb',
        'supported_new_alert_category': '00002a47-0000-1000-8000-00805f9b34fb',
        'supported_unread_alert_category': '00002a48-0000-1000-8000-00805f9b34fb',
        'system_id': '00002a23-0000-1000-8000-00805f9b34fb',
        'temperature': '00002a6e-0000-1000-8000-00805f9b34fb',
        'temperature_measurement': '00002a1c-0000-1000-8000-00805f9b34fb',
        'temperature_type': '00002a1d-0000-1000-8000-00805f9b34fb',
        'three_zone_heart_rate_limits': '00002a94-0000-1000-8000-00805f9b34fb',
        'time_accuracy': '00002a12-0000-1000-8000-00805f9b34fb',
        'time_source': '00002a13-0000-1000-8000-00805f9b34fb',
        'time_update_control_point': '00002a16-0000-1000-8000-00805f9b34fb',
        'time_update_state': '00002a17-0000-1000-8000-00805f9b34fb',
        'time_with_dst': '00002a11-0000-1000-8000-00805f9b34fb',
        'time_zone': '00002a0e-0000-1000-8000-00805f9b34fb',
        'true_wind_direction': '00002a71-0000-1000-8000-00805f9b34fb',
        'true_wind_speed': '00002a70-0000-1000-8000-00805f9b34fb',
        'two_zone_heart_rate_limit': '00002a95-0000-1000-8000-00805f9b34fb',
        'tx_power_level': '00002a07-0000-1000-8000-00805f9b34fb',
        'uncertainty': '00002ab4-0000-1000-8000-00805f9b34fb',
        'unread_alert_status': '00002a45-0000-1000-8000-00805f9b34fb',
        'user_control_point': '00002a9f-0000-1000-8000-00805f9b34fb',
        'user_index': '00002a9a-0000-1000-8000-00805f9b34fb',
        'uv_index': '00002a76-0000-1000-8000-00805f9b34fb',
        'vo2_max': '00002a96-0000-1000-8000-00805f9b34fb',
        'waist_circumference': '00002a97-0000-1000-8000-00805f9b34fb',
        'weight': '00002a98-0000-1000-8000-00805f9b34fb',
        'weight_measurement': '00002a9d-0000-1000-8000-00805f9b34fb',
        'weight_scale_feature': '00002a9e-0000-1000-8000-00805f9b34fb',
        'wind_chill': '00002a79-0000-1000-8000-00805f9b34fb'
    };
    const STANDARD_GATT_DESCRIPTORS = {
        'characteristic_extended_properties': '00002900-0000-1000-8000-00805f9b34fb',
        'characteristic_user_description': '00002901-0000-1000-8000-00805f9b34fb',
        'client_characteristic_configuration': '00002902-0000-1000-8000-00805f9b34fb',
        'server_characteristic_configuration': '00002903-0000-1000-8000-00805f9b34fb',
        'characteristic_presentation_format': '00002904-0000-1000-8000-00805f9b34fb',
        'characteristic_aggregate_format': '00002905-0000-1000-8000-00805f9b34fb',
        'valid_range': '00002906-0000-1000-8000-00805f9b34fb',
        'external_report_reference': '00002907-0000-1000-8000-00805f9b34fb',
        'report_reference': '00002908-0000-1000-8000-00805f9b34fb'
    };

    window.BluetoothUUID = {
        canonicalUUID: function (alias) {
            if (!alias) return null;
            let s = (typeof alias === 'number' ? alias.toString(16) : alias.toString()).toLowerCase();
            if (s.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) return s;
            if (s.startsWith('0x')) s = s.substring(2);
            
            if (s.length <= 4) s = s.padStart(4, '0');
            if (s.length <= 8) {
                return s.padStart(8, '0') + '-0000-1000-8000-00805f9b34fb';
            }
            if (s.length === 32) {
                return `${s.substring(0, 8)}-${s.substring(8, 12)}-${s.substring(12, 16)}-${s.substring(16, 20)}-${s.substring(20)}`;
            }
            return s;
        },
        getService: (a) => (typeof a === 'string' && STANDARD_GATT_SERVICES[a]) || BluetoothUUID.canonicalUUID(a),
        getCharacteristic: (a) => (typeof a === 'string' && STANDARD_GATT_CHARACTERISTICS[a]) || BluetoothUUID.canonicalUUID(a),
        getDescriptor: (a) => (typeof a === 'string' && STANDARD_GATT_DESCRIPTORS[a]) || BluetoothUUID.canonicalUUID(a)
    };

    // Helper to safely extract bytes from any BufferSource
    function getUint8Array(v) {
        if (v instanceof ArrayBuffer) {
            return new Uint8Array(v);
        }
        if (ArrayBuffer.isView(v)) {
            return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        }
        throw new TypeError("Value must be an ArrayBuffer or ArrayBufferView");
    }

    function bytesToBase64(bytes) {
        const binString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
        return btoa(binString);
    }

    function base64ToBytes(b64) {
        if (!b64) return null;
        const binString = atob(b64);
        const bytes = new Uint8Array(binString.length);
        for (let i = 0; i < binString.length; i++) {
            bytes[i] = binString.charCodeAt(i);
        }
        return bytes;
    }

    function b64ToDataView(b64) {
        const bytes = base64ToBytes(b64);
        return bytes ? new DataView(bytes.buffer) : null;
    }

    async function sendMessageFromPolyfill(command, args) {
        return new Promise((resolve, reject) => {
            const id = `polyfill-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            const listener = (e) => {
                if (e.source === window && e.data && e.data.type === 'FROM_CONTENT_SCRIPT' && e.data.id === id) {
                    window.removeEventListener('message', listener);
                    if (e.data.error) {
                        reject(new DOMException(e.data.error, "NetworkError"));
                    } else if (e.data.response && e.data.response.status === "error") {
                        const msg = e.data.response.message || "Unknown error";
                        let name = "UnknownError";
                        if (msg.includes("SecurityError")) name = "SecurityError";
                        if (msg.includes("not found")) name = "NotFoundError";
                        if (msg.includes("Invalid arguments")) name = "TypeError";
                        if (msg.includes("Not connected")) name = "NetworkError";
                        if (msg.includes("timed out")) name = "NetworkError";
                        reject(new DOMException(msg, name));
                    } else {
                        resolve(e.data.response);
                    }
                }
            };
            window.addEventListener('message', listener);
            window.postMessage({ type: 'FROM_PAGE', id, payload: { command, ...args } }, window.location.origin);
        });
    }

    class BluetoothEventTarget {
        constructor() { this._listeners = {}; }
        addEventListener(t, c) { (this._listeners[t] = this._listeners[t] || []).push(c); }
        removeEventListener(t, c) {
            if (!this._listeners[t]) return;
            const i = this._listeners[t].indexOf(c);
            if (i !== -1) this._listeners[t].splice(i, 1);
        }
        dispatchEvent(e) {
            try {
                Object.defineProperty(e, 'target', { value: this, writable: false, configurable: true });
            } catch (err) {}
            if (!this._listeners[e.type]) return true;
            [...this._listeners[e.type]].forEach(c => {
                try {
                    if (typeof c === 'function') c.call(this, e);
                    else if (c && typeof c.handleEvent === 'function') c.handleEvent(e);
                } catch (err) { console.error(err); }
            });
            return !e.defaultPrevented;
        }
    }

    class BluetoothRemoteGATTServer extends BluetoothEventTarget {
        constructor(d) { super(); this.device = d; this._connected = false; this._services = new Map(); }
        get connected() { return this._connected; }
        async connect() {
            const r = await sendMessageFromPolyfill('connect_device', { address: this.device.id });
            if (r.status === "success") return (this._connected = true), this;
            throw new Error(r.message || "Failed to connect");
        }
        async disconnect() {
            await sendMessageFromPolyfill('disconnect_device', { address: this.device.id });
            this._onDisconnected();
        }
        _onDisconnected() {
            if (this._connected) {
                this._connected = false;
                this._services.clear();
                this.device.dispatchEvent(new Event('gattserverdisconnected'));
            }
        }
        async getPrimaryService(s) {
            const u = window.BluetoothUUID.getService(s);
            if (this._services.has(u)) return this._services.get(u);
            const r = await sendMessageFromPolyfill('get_primary_service', { address: this.device.id, service_uuid: u });
            if (r.status === "success") {
                const srv = new BluetoothRemoteGATTService(this.device, r.uuid, true);
                this._services.set(r.uuid, srv);
                return srv;
            }
            throw new Error("Service not found");
        }
        async getPrimaryServices(s) {
            const u = s ? window.BluetoothUUID.getService(s) : null;
            const r = await sendMessageFromPolyfill('get_primary_services', { address: this.device.id });
            if (r.status === "success" && r.uuids) {
                let uuids = r.uuids;
                if (u) uuids = uuids.filter(x => window.BluetoothUUID.getService(x) === u);
                return uuids.map(x => {
                    if (this._services.has(x)) return this._services.get(x);
                    const srv = new BluetoothRemoteGATTService(this.device, x, true);
                    this._services.set(x, srv);
                    return srv;
                });
            }
            return [];
        }
    }

    class BluetoothRemoteGATTService extends BluetoothEventTarget {
        constructor(d, u, p) { super(); this.device = d; this.uuid = u; this.isPrimary = p; this._characteristics = new Map(); }
        async getCharacteristic(c) {
            const u = window.BluetoothUUID.getCharacteristic(c);
            if (this._characteristics.has(u)) return this._characteristics.get(u);
            const r = await sendMessageFromPolyfill('get_characteristics', { address: this.device.id, service_uuid: this.uuid });
            if (r.status === "success" && r.characteristics) {
                const d = r.characteristics.find(x => window.BluetoothUUID.getCharacteristic(x.uuid) === u);
                if (d) {
                    const char = new BluetoothRemoteGATTCharacteristic(this, d.uuid, d.properties);
                    this._characteristics.set(d.uuid, char);
                    return char;
                }
            }
            throw new Error("Characteristic not found");
        }
        async getCharacteristics(c) {
            const u = c ? window.BluetoothUUID.getCharacteristic(c) : null;
            const r = await sendMessageFromPolyfill('get_characteristics', { address: this.device.id, service_uuid: this.uuid });
            if (r.status === "success" && r.characteristics) {
                let chars = r.characteristics;
                if (u) chars = chars.filter(x => window.BluetoothUUID.getCharacteristic(x.uuid) === u);
                return chars.map(x => {
                    if (this._characteristics.has(x.uuid)) return this._characteristics.get(x.uuid);
                    const char = new BluetoothRemoteGATTCharacteristic(this, x.uuid, x.properties);
                    this._characteristics.set(x.uuid, char);
                    return char;
                });
            }
            return [];
        }
    }

    const characteristicRegistry = new Map();
    // Secondary index for O(1) notification dispatch: `deviceId|charUuid` -> Set<characteristic>
    const charNotifyIndex = new Map();

    class BluetoothCharacteristicProperties {
        constructor(p) {
            this.broadcast = !!p.broadcast;
            this.read = !!p.read;
            this.writeWithoutResponse = !!p.writeWithoutResponse;
            this.write = !!p.write;
            this.notify = !!p.notify;
            this.indicate = !!p.indicate;
            this.authenticatedSignedWrites = !!p.authenticatedSignedWrites;
            this.reliableWrite = !!p.reliableWrite;
            this.writableAuxiliaries = !!p.writableAuxiliaries;
        }
    }

    class BluetoothRemoteGATTCharacteristic extends BluetoothEventTarget {
        constructor(s, u, p) {
            super(); 
            this.service = s; 
            this.uuid = u; 
            this.value = null;
            this.properties = new BluetoothCharacteristicProperties(p || {});
            const k = `${s.device.id}|${s.uuid}|${u}`;
            if (!characteristicRegistry.has(k)) characteristicRegistry.set(k, new Set());
            characteristicRegistry.get(k).add(this);
            const nk = `${s.device.id}|${u}`;
            if (!charNotifyIndex.has(nk)) charNotifyIndex.set(nk, new Set());
            charNotifyIndex.get(nk).add(this);
        }
        _updateValue(b64) {
            const bytes = base64ToBytes(b64);
            if (bytes) {
                this.value = new DataView(bytes.buffer);
                this.dispatchEvent(new Event('characteristicvaluechanged'));
            }
        }
        async readValue() {
            const r = await sendMessageFromPolyfill('read_gatt_char', { address: this.service.device.id, service_uuid: this.service.uuid, char_uuid: this.uuid });
            if (r.status === "success") return this._updateValue(r.value), this.value;
            throw new Error(r.message || "Failed to read characteristic");
        }
        async writeValue(v) { return this.writeValueWithResponse(v); }
        async writeValueWithResponse(v) { return this._write(v, true); }
        async writeValueWithoutResponse(v) { return this._write(v, false); }
        async _write(v, resp) {
            const bytes = getUint8Array(v);
            const r = await sendMessageFromPolyfill('write_gatt_char', { 
                address: this.service.device.id, 
                service_uuid: this.service.uuid, 
                char_uuid: this.uuid, 
                value: bytesToBase64(bytes), 
                response: resp 
            });
            if (r.status !== "success") throw new Error(r.message || "Failed to write characteristic");
        }
        async startNotifications() {
            const r = await sendMessageFromPolyfill('start_notify', { address: this.service.device.id, service_uuid: this.service.uuid, char_uuid: this.uuid });
            if (r.status !== "success") throw new Error(r.message || "Failed to start notifications");
            return this;
        }
        async stopNotifications() {
            const r = await sendMessageFromPolyfill('stop_notify', { address: this.service.device.id, service_uuid: this.service.uuid, char_uuid: this.uuid });
            if (r.status !== "success") throw new Error(r.message || "Failed to stop notifications");
            return this;
        }
        async getDescriptor(d) {
            const u = window.BluetoothUUID.getDescriptor(d);
            const r = await sendMessageFromPolyfill('read_gatt_descriptor', { 
                address: this.service.device.id, 
                service_uuid: this.service.uuid,
                char_uuid: this.uuid, 
                descriptor_uuid: u 
            });
            if (r.status === "success") return new BluetoothRemoteGATTDescriptor(this, u, r.value);
            throw new Error("Descriptor not found");
        }
        async getDescriptors(d) {
            const u = d ? window.BluetoothUUID.getDescriptor(d) : null;
            const r = await sendMessageFromPolyfill('get_descriptors', { 
                address: this.service.device.id, 
                service_uuid: this.service.uuid,
                char_uuid: this.uuid 
            });
            if (r.status === "success" && r.uuids) {
                let uuids = r.uuids;
                if (u) uuids = uuids.filter(x => window.BluetoothUUID.getDescriptor(x) === u);
                return uuids.map(x => new BluetoothRemoteGATTDescriptor(this, x));
            }
            return [];
        }
    }

    class BluetoothRemoteGATTDescriptor {
        constructor(c, u, b64) { 
            this.characteristic = c; 
            this.uuid = u; 
            this.value = null;
            if (b64) this._updateValue(b64); 
        }
        _updateValue(b64) {
            this.value = b64ToDataView(b64);
        }
        async readValue() {
            const r = await sendMessageFromPolyfill('read_gatt_descriptor', { 
                address: this.characteristic.service.device.id, 
                service_uuid: this.characteristic.service.uuid,
                char_uuid: this.characteristic.uuid, 
                descriptor_uuid: this.uuid 
            });
            if (r.status === "success") return this._updateValue(r.value), this.value;
            throw new Error(r.message || "Failed to read descriptor");
        }
        async writeValue(v) {
            const bytes = getUint8Array(v);
            const r = await sendMessageFromPolyfill('write_gatt_descriptor', { 
                address: this.characteristic.service.device.id, 
                service_uuid: this.characteristic.service.uuid,
                char_uuid: this.characteristic.uuid, 
                descriptor_uuid: this.uuid, 
                value: bytesToBase64(bytes)
            });
            if (r.status !== "success") throw new Error(r.message || "Failed to write descriptor");
        }
    }

    const deviceRegistry = new Map();

    window.addEventListener('message', (e) => {
        if (e.source !== window || !e.data || e.data.type !== 'FROM_CONTENT_SCRIPT') return;
        if (e.data.event === 'gatt_notification') {
            const { address, service_uuid, char_uuid, value } = e.data.data;
            const nk = `${address}|${char_uuid}`;
            const chars = charNotifyIndex.get(nk);
            if (chars) {
                chars.forEach(c => {
                    if (!service_uuid || c.service.uuid === service_uuid) c._updateValue(value);
                });
            }
        } else if (e.data.event === 'device_disconnected') {
            const d = deviceRegistry.get(e.data.data.address);
            if (d && d.gatt) d.gatt._onDisconnected();

            for (const key of characteristicRegistry.keys()) {
                if (key.startsWith(`${e.data.data.address}|`)) {
                    characteristicRegistry.delete(key);
                }
            }
            for (const key of charNotifyIndex.keys()) {
                if (key.startsWith(`${e.data.data.address}|`)) {
                    charNotifyIndex.delete(key);
                }
            }
        } else if (e.data.event === 'advertisement_received') {
            const d = deviceRegistry.get(e.data.data.address);
            if (d) {
                const advData = e.data.data;
                const mDataMap = new Map();
                if (advData.manufacturerData) {
                    for (const [id, val] of Object.entries(advData.manufacturerData)) {
                        mDataMap.set(parseInt(id, 16), b64ToDataView(val));
                    }
                }
                const sDataMap = new Map();
                if (advData.serviceData) {
                    for (const [uuid, val] of Object.entries(advData.serviceData)) {
                        sDataMap.set(uuid.toLowerCase(), b64ToDataView(val));
                    }
                }
                const detail = {
                    ...advData,
                    manufacturerData: mDataMap,
                    serviceData: sDataMap
                };
                d.dispatchEvent(new CustomEvent('advertisementreceived', { detail }));
            }
        }
    });

    class BluetoothDevice extends BluetoothEventTarget {
        constructor(id, name) { 
            super(); 
            this.id = id; 
            this.name = name; 
            this.gatt = new BluetoothRemoteGATTServer(this); 
            deviceRegistry.set(id, this); 
        }
        async watchAdvertisements() { 
            await sendMessageFromPolyfill('watch_advertisements', { address: this.id }); 
            return true; 
        }
        async forget() { 
            await sendMessageFromPolyfill('forget_device', { address: this.id });
            deviceRegistry.delete(this.id); 
        }
    }

    navigator.bluetooth = {
        requestDevice: async (o) => {
            if (window.navigator.userActivation && !window.navigator.userActivation.isActive) {
                throw new DOMException("Must be handling a user gesture to show a permission picker.", "SecurityError");
            }

            if (!o || (!o.acceptAllDevices && (!o.filters || o.filters.length === 0))) {
                throw new TypeError("Failed to execute 'requestDevice': Either 'filters' or 'acceptAllDevices' must be specified.");
            }

            const normalizedFilters = o.filters ? o.filters.map(f => ({
                ...f,
                services: f.services ? f.services.map(s => window.BluetoothUUID.getService(s)) : []
            })) : [];
            const normalizedOptional = o.optionalServices ? o.optionalServices.map(s => window.BluetoothUUID.getService(s)) : [];

            const r = await sendMessageFromPolyfill('request_device', { 
                options: {
                    acceptAllDevices: o.acceptAllDevices,
                    filters: normalizedFilters,
                    optionalServices: normalizedOptional
                }
            });
            
            if (r.status !== "success") throw new Error(r.message || "User cancelled or failed to pair");
            const existingDevice = deviceRegistry.get(r.device.id);
            if (existingDevice) {
                existingDevice.name = r.device.name;
                return existingDevice;
            }
            return new BluetoothDevice(r.device.id, r.device.name);
        },
        getAvailability: async () => {
            const r = await sendMessageFromPolyfill('check_availability', {});
            return r.status === "success" && r.available;
        },
        getDevices: async () => {
            const r = await sendMessageFromPolyfill('get_authorized_devices', {});
            return r.status === "success" ? r.devices.map(d => {
                const existing = deviceRegistry.get(d.id);
                if (existing) { existing.name = d.name; return existing; }
                return new BluetoothDevice(d.id, d.name);
            }) : [];
        }
    };
}
