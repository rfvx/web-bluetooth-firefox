#!/usr/bin/env python3
import sys
import re
import json
import struct
import asyncio
from base64 import b64encode, b64decode
import logging

# Regex for validating standard UUID formats
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" # 128-bit
)

def is_valid_uuid_format(uuid_string):
    """Checks if a string is a valid 128-bit UUID format."""
    if not isinstance(uuid_string, str):
        return False
    return bool(UUID_RE.fullmatch(uuid_string.lower()))

# Setup basic logging to stderr for debugging
logging.basicConfig(level=logging.DEBUG, stream=sys.stderr, format='%(asctime)s - %(levelname)s - %(message)s')

try:
    from bleak import BleakScanner, BleakClient
except ImportError:
    logging.critical("Bleak library not found. Please install it with 'pip install bleak'.")
    sys.exit(1)

# Mapping for active BLE connections (device_address -> BleakClient instance)
connected_clients = {}
# Per-device locks to serialize GATT operations
device_locks = {}

# Global scanner instance for advertisement watching
advertisement_scanner = None
# Cache for throttling advertisements (address -> last_sent_timestamp)
advertisement_cache = {}
MAX_ADVERTISEMENT_CACHE_SIZE = 1000
ADVERTISEMENT_THROTTLE_INTERVAL = 0.1 # seconds
GATT_TIMEOUT = 10.0  # seconds for individual GATT operations

# Module-level reference to the running asyncio event loop (set in main_loop)
_loop = None

# Structure to hold notification subscriptions
# device_address -> { char_uuid: notification_callback_id }
notification_subscriptions = {}

# Lock for serializing access to stdout
send_lock = asyncio.Lock()

def normalize_uuid(uuid):
    """Ensure UUID is in standard 128-bit lowercase format.
    Returns None if the input is not a valid UUID format after normalization attempts."""
    if not uuid:
        return None
    
    u_str = None
    if isinstance(uuid, int):
        u_str = f"{uuid:x}"
    else:
        u_str = str(uuid).lower().replace('-', '')
        if u_str.startswith('0x'):
            u_str = u_str[2:]
            
    # Attempt to convert 16-bit or 32-bit UUIDs to 128-bit format
    if len(u_str) == 4: # 16-bit
        normalized_uuid = f"0000{u_str}-0000-1000-8000-00805f9b34fb"
    elif len(u_str) == 8: # 32-bit
        normalized_uuid = f"{u_str}-0000-1000-8000-00805f9b34fb"
    elif len(u_str) == 32: # Already a 128-bit hex string
        normalized_uuid = f"{u_str[0:8]}-{u_str[8:12]}-{u_str[12:16]}-{u_str[16:20]}-{u_str[20:]}"
    else:
        # If it's not 4, 8, or 32 hex chars, it's not a standard GATT UUID format we can normalize
        logging.debug(f"UUID '{uuid}' has an unhandled length for normalization: {len(u_str)}")
        return None

    if is_valid_uuid_format(normalized_uuid):
        return normalized_uuid
    else:
        logging.warning(f"Normalized UUID '{normalized_uuid}' (from original '{uuid}') failed final validation.")
        return None

async def send_message(message_content):
    async with send_lock:
        try:
            encoded_content = json.dumps(message_content).encode('utf-8')
            # Use '=' for native byte order and standard 32-bit size
            encoded_length = struct.pack('=I', len(encoded_content))
            sys.stdout.buffer.write(encoded_length)
            sys.stdout.buffer.write(encoded_content)
            sys.stdout.buffer.flush()
        except Exception as e:
            logging.error(f"Failed to send message: {e}")

def on_disconnection(client):
    address = client.address
    logging.info(f"Device {address} disconnected.")
    if address in connected_clients:
        del connected_clients[address]
    if address in device_locks:
        del device_locks[address]
    if address in notification_subscriptions:
        del notification_subscriptions[address]
    
    if _loop and _loop.is_running():
        try:
            _loop.call_soon_threadsafe(_loop.create_task, send_message({
                "event": "device_disconnected",
                "address": address
            }))
        except Exception as e:
            logging.error(f"Error triggering disconnection message: {e}")
    else:
        logging.warning(f"Loop not running, skipping disconnection event for {address}")

def _cleanup_advertisement_cache():
    if len(advertisement_cache) > MAX_ADVERTISEMENT_CACHE_SIZE:
        keys = sorted(advertisement_cache.keys(), key=lambda k: advertisement_cache[k])
        for k in keys[:int(MAX_ADVERTISEMENT_CACHE_SIZE * 0.1)]:
            advertisement_cache.pop(k, None)

async def handle_command(command_data):
    global advertisement_scanner
    command = command_data.get("command")
    address = command_data.get("address")
    service_uuid = normalize_uuid(command_data.get("service_uuid"))
    char_uuid = normalize_uuid(command_data.get("char_uuid"))
    value_b64 = command_data.get("value")
    with_response = command_data.get("response", False)

    # Basic host-side command whitelist
    ALLOWED_COMMANDS = [
        "check_availability", "connect_device", "disconnect_device",
        "get_primary_services", "get_primary_service", "get_characteristics", 
        "get_descriptors", "read_gatt_char", "write_gatt_char", "start_notify", 
        "stop_notify", "read_gatt_descriptor", "write_gatt_descriptor",
        "watch_advertisements", "stop_watch_advertisements"
    ]

    if command not in ALLOWED_COMMANDS:
        return {"status": "error", "message": f"Unauthorized or unknown command: {command}"}

    logging.debug(f"Received command: {command}")
    
    # Helper for parameter validation
    def validate_param(param_name, value, required=False, type_check=None, min_len=None, max_len=None, custom_validation=None):
        if required and (value is None or (isinstance(value, str) and not value.strip())):
            return False, f"{param_name} is required."
        if value is not None:
            if type_check is not None and not isinstance(value, type_check):
                return False, f"{param_name} must be of type {type_check.__name__}."
            if isinstance(value, str):
                if min_len is not None and len(value) < min_len:
                    return False, f"{param_name} must be at least {min_len} characters long."
                if max_len is not None and len(value) > max_len:
                    return False, f"{param_name} cannot exceed {max_len} characters."
            if custom_validation and not custom_validation(value):
                return False, f"{param_name} failed custom validation."
        return True, None

    # Validate common parameters
    if command not in ["check_availability", "scan_devices", "watch_advertisements", "stop_watch_advertisements"]:
        # All other commands require a valid address
        if not address:
            return {"status": "error", "message": "Device address is required."}
        # Basic MAC address format validation (example, can be more robust)
        if not re.match(r"^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$", address):
            return {"status": "error", "message": "Invalid device address format."}

    # Helper to get/create per-device lock
    def get_lock(addr):
        if addr not in device_locks:
            device_locks[addr] = asyncio.Lock()
        return device_locks[addr]

    try:
        if command == "check_availability":
            if advertisement_scanner is not None:
                return {"status": "success", "available": True}
            try:
                scanner = BleakScanner()
                await scanner.start()
                await scanner.stop()
                return {"status": "success", "available": True}
            except Exception:
                return {"status": "success", "available": False}

        elif command == "connect_device":
            is_valid, error_msg = validate_param("address", address, required=True, custom_validation=lambda x: re.match(r"^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$", x))
            if not is_valid:
                return {"status": "error", "message": error_msg}
            async with get_lock(address):
                if address in connected_clients and connected_clients[address].is_connected:
                    return {"status": "success", "message": "Already connected", "address": address}
                client = BleakClient(address, disconnected_callback=on_disconnection, timeout=20.0)
                try:
                    await client.connect()
                    await asyncio.wait_for(client.get_services(), timeout=20.0)
                    connected_clients[address] = client
                    return {"status": "success", "address": address}
                except Exception as e:
                    logging.error(f"Failed to connect to {address}: {e}")
                    if client.is_connected:
                        await client.disconnect()
                    return {"status": "error", "message": str(e)}

        elif command == "disconnect_device":
            is_valid, error_msg = validate_param("address", address, required=True, custom_validation=lambda x: re.match(r"^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$", x))
            if not is_valid:
                return {"status": "error", "message": error_msg}
            async with get_lock(address):
                if address in connected_clients:
                    client = connected_clients[address]
                    if client.is_connected:
                        await client.disconnect()
                    del connected_clients[address]
                return {"status": "success", "address": address}

        elif command == "get_primary_services":
            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": "Device not connected."}
            async with get_lock(address):
                client = connected_clients[address]
                services = [s.uuid.lower() for s in client.services]
                return {"status": "success", "uuids": services}

        elif command == "get_primary_service":
            is_valid, error_msg = validate_param("service_uuid", command_data.get("service_uuid"), required=True, custom_validation=is_valid_uuid_format)
            if not is_valid:
                return {"status": "error", "message": error_msg}
            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": "Device not connected."}
            async with get_lock(address):
                client = connected_clients[address]
                service = client.services.get_service(service_uuid)
                if service:
                    return {"status": "success", "uuid": service.uuid.lower()}
                return {"status": "error", "message": "Service not found."}

        elif command == "get_characteristics":
            is_valid, error_msg = validate_param("service_uuid", command_data.get("service_uuid"), required=True, custom_validation=is_valid_uuid_format)
            if not is_valid:
                return {"status": "error", "message": error_msg}
            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": "Device not connected."}
            async with get_lock(address):
                client = connected_clients[address]
                service = client.services.get_service(service_uuid)
                if service:
                    chars = []
                    for c in service.characteristics:
                        chars.append({
                            "uuid": c.uuid.lower(),
                            "properties": {
                                "broadcast": "broadcast" in c.properties,
                                "read": "read" in c.properties,
                                "writeWithoutResponse": "write-without-response" in c.properties,
                                "write": "write" in c.properties,
                                "notify": "notify" in c.properties,
                                "indicate": "indicate" in c.properties,
                                "authenticatedSignedWrites": "authenticated-signed-writes" in c.properties,
                                "reliableWrite": "reliable-write" in c.properties,
                                "writableAuxiliaries": "writable-auxiliaries" in c.properties
                            }
                        })
                    return {"status": "success", "characteristics": chars}
                return {"status": "error", "message": "Service not found."}

        elif command == "get_descriptors":
            is_valid, error_msg = validate_param("char_uuid", command_data.get("char_uuid"), required=True, custom_validation=is_valid_uuid_format)
            if not is_valid:
                return {"status": "error", "message": error_msg}
            if command_data.get("service_uuid"):
                is_valid, error_msg = validate_param("service_uuid", command_data.get("service_uuid"), custom_validation=is_valid_uuid_format)
                if not is_valid:
                    return {"status": "error", "message": error_msg}
            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": "Device not connected."}
            async with get_lock(address):
                client = connected_clients[address]
                if service_uuid:
                    service = client.services.get_service(service_uuid)
                    if not service: return {"status": "error", "message": "Service not found."}
                    char = service.get_characteristic(char_uuid)
                else:
                    char = client.services.get_characteristic(char_uuid)
                
                if char:
                    return {"status": "success", "uuids": [d.uuid.lower() for d in char.descriptors]}
                return {"status": "error", "message": "Characteristic not found."}

        elif command == "read_gatt_char":
            is_valid, error_msg = validate_param("char_uuid", command_data.get("char_uuid"), required=True, custom_validation=is_valid_uuid_format)
            if not is_valid:
                return {"status": "error", "message": error_msg}
            if command_data.get("service_uuid"):
                is_valid, error_msg = validate_param("service_uuid", command_data.get("service_uuid"), custom_validation=is_valid_uuid_format)
                if not is_valid:
                    return {"status": "error", "message": error_msg}
            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": "Device not connected."}
            client = connected_clients[address]
            async with get_lock(address):
                if service_uuid:
                    service = client.services.get_service(service_uuid)
                    if not service: return {"status": "error", "message": "Service not found."}
                    char = service.get_characteristic(char_uuid)
                    if not char: return {"status": "error", "message": "Characteristic not found."}
                    value_bytes = await asyncio.wait_for(client.read_gatt_char(char.handle), timeout=GATT_TIMEOUT)
                else:
                    value_bytes = await asyncio.wait_for(client.read_gatt_char(char_uuid), timeout=GATT_TIMEOUT)
                return {"status": "success", "value": b64encode(value_bytes).decode('utf-8')}

        elif command == "write_gatt_char":
            is_valid, error_msg = validate_param("char_uuid", command_data.get("char_uuid"), required=True, custom_validation=is_valid_uuid_format)
            if not is_valid:
                return {"status": "error", "message": error_msg}
            if command_data.get("service_uuid"):
                is_valid, error_msg = validate_param("service_uuid", command_data.get("service_uuid"), custom_validation=is_valid_uuid_format)
                if not is_valid:
                    return {"status": "error", "message": error_msg}
            is_valid, error_msg = validate_param("value", value_b64, required=True, type_check=str)
            if not is_valid:
                return {"status": "error", "message": error_msg}
            
            # Max GATT MTU is typically 23 (minus 3 for opcode and handle), but can be higher.
            # Let's enforce a reasonable limit to prevent DoS with excessively large writes.
            MAX_WRITE_VALUE_BYTES = 512 # A reasonable upper bound for typical BLE writes
            try:
                value_bytes = b64decode(value_b64, validate=True)
                if len(value_bytes) > MAX_WRITE_VALUE_BYTES:
                    return {"status": "error", "message": f"Value too large. Max {MAX_WRITE_VALUE_BYTES} bytes allowed."}
            except Exception:
                return {"status": "error", "message": "Invalid base64 encoding for value."}

            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": "Device not connected."}
            client = connected_clients[address]
            async with get_lock(address):
                if service_uuid:
                    service = client.services.get_service(service_uuid)
                    if not service: return {"status": "error", "message": "Service not found."}
                    char = service.get_characteristic(char_uuid)
                    if not char: return {"status": "error", "message": "Characteristic not found."}
                    await asyncio.wait_for(client.write_gatt_char(char.handle, value_bytes, response=with_response), timeout=GATT_TIMEOUT)
                else:
                    await asyncio.wait_for(client.write_gatt_char(char_uuid, value_bytes, response=with_response), timeout=GATT_TIMEOUT)
                return {"status": "success"}

        elif command == "start_notify":
            is_valid, error_msg = validate_param("char_uuid", command_data.get("char_uuid"), required=True, custom_validation=is_valid_uuid_format)
            if not is_valid:
                return {"status": "error", "message": error_msg}
            if command_data.get("service_uuid"):
                is_valid, error_msg = validate_param("service_uuid", command_data.get("service_uuid"), custom_validation=is_valid_uuid_format)
                if not is_valid:
                    return {"status": "error", "message": error_msg}
            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": "Device not connected."}

            client = connected_clients[address]

            # Find the characteristic first to ensure we have the correct service_uuid
            char = None
            if service_uuid:
                service = client.services.get_service(service_uuid)
                if service:
                    char = service.get_characteristic(char_uuid)
            else:
                char = client.services.get_characteristic(char_uuid)

            if not char:
                return {"status": "error", "message": "Characteristic not found."}

            actual_service_uuid = char.service_uuid.lower()
            actual_char_uuid = char.uuid.lower()

            def notification_handler(sender, data):
                # sender can be a BleakGATTCharacteristic or a handle (int)
                _loop.call_soon_threadsafe(_loop.create_task, send_message({
                    "event": "gatt_notification",
                    "address": address,
                    "service_uuid": actual_service_uuid,
                    "char_uuid": actual_char_uuid,
                    "value": b64encode(data).decode('utf-8')
                }))

            async with get_lock(address):
                if address not in notification_subscriptions:
                    notification_subscriptions[address] = {}
                if actual_char_uuid not in notification_subscriptions[address]:
                    await asyncio.wait_for(client.start_notify(char.handle, notification_handler), timeout=GATT_TIMEOUT)
                    notification_subscriptions[address][actual_char_uuid] = True
                return {"status": "success"}

        elif command == "stop_notify":
            is_valid, error_msg = validate_param("char_uuid", command_data.get("char_uuid"), required=True, custom_validation=is_valid_uuid_format)
            if not is_valid:
                return {"status": "error", "message": error_msg}
            if command_data.get("service_uuid"):
                is_valid, error_msg = validate_param("service_uuid", command_data.get("service_uuid"), custom_validation=is_valid_uuid_format)
                if not is_valid:
                    return {"status": "error", "message": error_msg}
            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": "Device not connected."}
            async with get_lock(address):
                if address in notification_subscriptions and char_uuid in notification_subscriptions[address]:
                    client = connected_clients[address]
                    if service_uuid:
                        service = client.services.get_service(service_uuid)
                        if not service: return {"status": "error", "message": "Service not found."}
                        char = service.get_characteristic(char_uuid)
                        if not char: return {"status": "error", "message": "Characteristic not found."}
                        await asyncio.wait_for(client.stop_notify(char.handle), timeout=GATT_TIMEOUT)
                    else:
                        await asyncio.wait_for(client.stop_notify(char_uuid), timeout=GATT_TIMEOUT)
                    del notification_subscriptions[address][char_uuid]
                return {"status": "success"}

        elif command == "read_gatt_descriptor":
            is_valid, error_msg = validate_param("service_uuid", command_data.get("service_uuid"), required=True, custom_validation=is_valid_uuid_format)
            if not is_valid:
                return {"status": "error", "message": error_msg}
            is_valid, error_msg = validate_param("char_uuid", command_data.get("char_uuid"), required=True, custom_validation=is_valid_uuid_format)
            if not is_valid:
                return {"status": "error", "message": error_msg}
            is_valid, error_msg = validate_param("descriptor_uuid", command_data.get("descriptor_uuid"), required=True, custom_validation=is_valid_uuid_format)
            if not is_valid:
                return {"status": "error", "message": error_msg}
            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": "Device not connected."}
            client = connected_clients[address]
            async with get_lock(address):
                service = client.services.get_service(service_uuid)
                if not service: return {"status": "error", "message": "Service not found."}
                char = next((c for c in service.characteristics if c.uuid.lower() == char_uuid.lower()), None)
                if not char: return {"status": "error", "message": "Characteristic not found."}
                descriptor = next((d for d in char.descriptors if d.uuid.lower() == descriptor_uuid.lower()), None)
                if not descriptor: return {"status": "error", "message": "Descriptor not found."}
                value = await asyncio.wait_for(client.read_gatt_descriptor(descriptor.handle), timeout=GATT_TIMEOUT)
                return {"status": "success", "value": b64encode(value).decode('utf-8')}

        elif command == "write_gatt_descriptor":
            is_valid, error_msg = validate_param("service_uuid", command_data.get("service_uuid"), required=True, custom_validation=is_valid_uuid_format)
            if not is_valid:
                return {"status": "error", "message": error_msg}
            is_valid, error_msg = validate_param("char_uuid", command_data.get("char_uuid"), required=True, custom_validation=is_valid_uuid_format)
            if not is_valid:
                return {"status": "error", "message": error_msg}
            is_valid, error_msg = validate_param("descriptor_uuid", command_data.get("descriptor_uuid"), required=True, custom_validation=is_valid_uuid_format)
            if not is_valid:
                return {"status": "error", "message": error_msg}
            is_valid, error_msg = validate_param("value", value_b64, required=True, type_check=str)
            if not is_valid:
                return {"status": "error", "message": error_msg}

            MAX_WRITE_VALUE_BYTES = 512
            try:
                value_bytes = b64decode(value_b64, validate=True)
                if len(value_bytes) > MAX_WRITE_VALUE_BYTES:
                    return {"status": "error", "message": f"Value too large. Max {MAX_WRITE_VALUE_BYTES} bytes allowed."}
            except Exception:
                return {"status": "error", "message": "Invalid base64 encoding for value."}
            
            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": "Device not connected."}
            client = connected_clients[address]
            async with get_lock(address):
                service = client.services.get_service(service_uuid)
                if not service: return {"status": "error", "message": "Service not found."}
                char = next((c for c in service.characteristics if c.uuid.lower() == char_uuid.lower()), None)
                if not char: return {"status": "error", "message": "Characteristic not found."}
                descriptor = next((d for d in char.descriptors if d.uuid.lower() == descriptor_uuid.lower()), None)
                if not descriptor: return {"status": "error", "message": "Descriptor not found."}
                await asyncio.wait_for(client.write_gatt_descriptor(descriptor.handle, value_bytes), timeout=GATT_TIMEOUT)
                return {"status": "success"}

        elif command == "watch_advertisements":
            global advertisement_scanner

            if advertisement_scanner is None:
                logging.info("Starting advertisement scanner.")
                import time
                def advertisement_callback(device, advertisement_data):
                    now = time.time()
                    if now - advertisement_cache.get(device.address, 0) < ADVERTISEMENT_THROTTLE_INTERVAL:
                        return
                    advertisement_cache[device.address] = now
                    if len(advertisement_cache) > MAX_ADVERTISEMENT_CACHE_SIZE and _loop and _loop.is_running():
                        _loop.call_soon_threadsafe(_cleanup_advertisement_cache)
                    
                    mdata = {}
                    for id, data in advertisement_data.manufacturer_data.items():
                        mdata[f"0x{id:04x}"] = b64encode(data).decode('utf-8')
                    sdata = {}
                    for uuid, data in advertisement_data.service_data.items():
                        sdata[uuid] = b64encode(data).decode('utf-8')
                    
                    if _loop and _loop.is_running():
                        _loop.call_soon_threadsafe(_loop.create_task, send_message({
                            "event": "advertisement_received",
                            "address": device.address,
                            "name": device.name or advertisement_data.local_name or "Unknown",
                            "rssi": advertisement_data.rssi,
                            "txPower": advertisement_data.tx_power,
                            "uuids": [normalize_uuid(u) for u in advertisement_data.service_uuids],
                            "manufacturerData": mdata,
                            "serviceData": sdata
                        }))
                
                advertisement_scanner = BleakScanner(advertisement_callback)
                await advertisement_scanner.start()
            return {"status": "success"}

        elif command == "stop_watch_advertisements":
            global advertisement_scanner
            
            if advertisement_scanner is not None:
                logging.info("Stopping advertisement scanner.")
                await advertisement_scanner.stop()
                advertisement_scanner = None
                advertisement_cache.clear()
            return {"status": "success"}

        else:
            return {"status": "error", "message": f"Unknown command: {command}"}

    except asyncio.TimeoutError:
        return {"status": "error", "message": "Operation timed out."}
    except Exception:
        logging.exception(f"Error handling command {command}") # Log full traceback internally
        return {"status": "error", "message": "An internal host error occurred."}

class MalformedMessageError(Exception):
    """Raised when a message from the client is not valid JSON."""
    pass

def get_message():
    """Reads a message from stdin and decodes the 32-bit length prefix."""
    try:
        raw_length = sys.stdin.buffer.read(4)
        if len(raw_length) < 4:
            return None # stdin closed
        # Use '=' for native byte order and standard 32-bit size
        message_length = struct.unpack('=I', raw_length)[0]
        if message_length > 1024 * 1024:
            logging.error(f"Message too large: {message_length} bytes exceeds 1MB native messaging limit")
            return None
        message_bytes = sys.stdin.buffer.read(message_length)
        if len(message_bytes) < message_length:
            return None
        message = message_bytes.decode('utf-8')
        try:
            return json.loads(message)
        except json.JSONDecodeError as e:
            raise MalformedMessageError(str(e))
    except Exception as e:
        if not isinstance(e, MalformedMessageError):
            logging.error(f"Error reading from stdin: {e}")
        raise

async def process_request(received_data):
    """Handles a single request and sends a response back to the client."""
    try:
        if not isinstance(received_data, dict):
            await send_message({"status": "error", "message": "Invalid message format. Expected a JSON object."})
            return
            
        request_id = received_data.get("requestId")
        response_data = await handle_command(received_data)
        
        if request_id is not None:
            response_data["requestId"] = request_id
        await send_message(response_data)
    except Exception as e:
        logging.exception(f"Error processing request: {e}")
        try:
            req_id = received_data.get("requestId") if isinstance(received_data, dict) else None
            await send_message({
                "status": "error", 
                "message": f"Internal host error: {str(e)}", 
                "requestId": req_id
            })
        except: pass

async def main_loop():
    global _loop
    logging.info("Starting Native Messaging Host main loop.")
    _loop = asyncio.get_running_loop()
    loop = _loop
    pending_tasks = set()
    consecutive_errors = 0
    MAX_CONSECUTIVE_ERRORS = 5
    ERROR_RETRY_DELAY = 1 # seconds

    try:
        while True:
            try:
                received_data = await loop.run_in_executor(None, get_message)
                if received_data is None: # stdin closed
                    logging.info("End of stdin, exiting main loop.")
                    break
                
                task = asyncio.create_task(process_request(received_data))
                pending_tasks.add(task)
                task.add_done_callback(pending_tasks.discard)
                consecutive_errors = 0 # Reset error counter on success
            except MalformedMessageError as e:
                logging.error(f"Received malformed JSON message: {e}")
                consecutive_errors += 1
            except Exception as e:
                logging.exception(f"Unhandled exception in main loop: {e}")
                consecutive_errors += 1

            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                logging.critical(f"Exceeded {MAX_CONSECUTIVE_ERRORS} consecutive errors, shutting down.")
                break
            
            if consecutive_errors > 0:
                await asyncio.sleep(ERROR_RETRY_DELAY)
    finally:
        logging.info("Shutting down. Cleaning up connections...")
        # Wait for pending tasks with a short timeout
        if pending_tasks:
            await asyncio.wait(pending_tasks, timeout=2.0)
        
        # Copy to avoid modification during iteration
        clients = list(connected_clients.values())
        for client in clients:
            try:
                if client.is_connected:
                    await client.disconnect()
            except Exception as e:
                logging.error(f"Error disconnecting client {client.address}: {e}")
        
        if advertisement_scanner:
            try:
                await advertisement_scanner.stop()
            except: pass

if __name__ == "__main__":
    try:
        asyncio.run(main_loop())
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        logging.critical(f"Fatal error: {e}")
        sys.exit(1)
