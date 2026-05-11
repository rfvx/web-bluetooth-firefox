#!/usr/bin/env python3
import sys
import json
import struct
import asyncio
from bleak import BleakScanner, BleakClient
from base64 import b64encode, b64decode
import logging

# Setup basic logging to stderr for debugging
logging.basicConfig(level=logging.DEBUG, stream=sys.stderr, format='%(asctime)s - %(levelname)s - %(message)s')

# Mapping for active BLE connections (device_address -> BleakClient instance)
connected_clients = {}

# Structure to hold notification subscriptions
# device_address -> { char_uuid: notification_callback_id }
notification_subscriptions = {}

def send_message(message_content):
    try:
        encoded_content = json.dumps(message_content).encode('utf-8')
        encoded_length = struct.pack('@I', len(encoded_content))
        sys.stdout.buffer.write(encoded_length)
        sys.stdout.buffer.write(encoded_content)
        sys.stdout.buffer.flush()
        logging.debug(f"Sent message: {message_content}")
    except Exception as e:
        logging.error(f"Failed to send message: {e}")

def on_disconnection(client):
    address = client.address
    logging.info(f"Device {address} disconnected.")
    if address in connected_clients:
        del connected_clients[address]
    if address in notification_subscriptions:
        del notification_subscriptions[address]
    send_message({
        "event": "device_disconnected",
        "address": address
    })

async def handle_command(command_data):
    command = command_data.get("command")
    address = command_data.get("address")
    options = command_data.get("options", {})
    service_uuid = command_data.get("service_uuid") # For GATT operations
    char_uuid = command_data.get("char_uuid") # For GATT operations
    value_b64 = command_data.get("value") # For write operations
    with_response = command_data.get("response", False) # For write operations

    logging.debug(f"Received command: {command_data}")

    try:
        if command == "check_availability":
            return {"status": "success", "available": True}

        elif command == "scan_devices":
            timeout = options.get("timeout", 10)
            logging.debug(f"Scanning for devices with timeout: {timeout}")
            devices = await BleakScanner(timeout=timeout).discover()
            device_list = []
            for d in devices:
                # Aggressively collect UUIDs from all possible places
                uuids = []
                
                # 1. Standard Bleak metadata
                metadata = getattr(d, 'metadata', {})
                if isinstance(metadata, dict):
                    uuids.extend(metadata.get("uuids", []))
                
                # 2. BlueZ-specific details (D-Bus properties)
                details = getattr(d, 'details', {})
                if isinstance(details, dict):
                    # Check for BlueZ 'UUIDs' property
                    props = details.get("props", {}) if "props" in details else details
                    if isinstance(props, dict):
                        uuids.extend(props.get("UUIDs", []))

                # Normalize and deduplicate
                unique_uuids = list(set(u.lower() for u in uuids if isinstance(u, str)))
                
                device_list.append({
                    "name": d.name or "Unknown",
                    "address": d.address,
                    "uuids": unique_uuids
                })
            
            logging.debug(f"Found {len(device_list)} devices. Meshtastic? {'Yes' if any('6ba1b218' in u for dev in device_list for u in dev['uuids']) else 'No'}")
            return {"status": "success", "devices": device_list}

        elif command == "connect_device":
            if not address:
                return {"status": "error", "message": "Device address is required for connect_device"}
            
            logging.debug(f"Attempting to connect to: {address}")
            if address in connected_clients and connected_clients[address].is_connected:
                logging.debug(f"Already connected to {address}")
                return {"status": "success", "message": "Already connected", "address": address}
            
            client = BleakClient(address, disconnected_callback=on_disconnection)
            await client.connect()
            connected_clients[address] = client
            logging.debug(f"Successfully connected to {address}")
            return {"status": "success", "address": address}

        elif command == "disconnect_device":
            if not address:
                return {"status": "error", "message": "Device address is required for disconnect_device"}
            
            logging.debug(f"Attempting to disconnect from: {address}")
            if address in connected_clients and connected_clients[address].is_connected:
                await connected_clients[address].disconnect()
                # on_disconnection callback will handle cleanup
                logging.debug(f"Successfully disconnected from {address}")
            else:
                logging.warning(f"Attempted to disconnect from {address}, but not connected or client not found.")
            return {"status": "success", "address": address}

        elif command == "get_primary_services":
            if not address:
                return {"status": "error", "message": "Device address is required for get_primary_services"}
            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": f"Not connected to {address}"}
            
            client = connected_clients[address]
            services = [s.uuid for s in client.services]
            return {"status": "success", "uuids": services}

        elif command == "get_primary_service":
            if not address or not service_uuid:
                return {"status": "error", "message": "Address and service_uuid are required for get_primary_service"}
            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": f"Not connected to {address}"}
            
            client = connected_clients[address]
            service = client.services.get_service(service_uuid)
            if service:
                return {"status": "success", "uuid": service.uuid}
            else:
                return {"status": "error", "message": f"Service {service_uuid} not found"}

        elif command == "get_characteristics":
            if not address or not service_uuid:
                return {"status": "error", "message": "Address and service_uuid are required for get_characteristics"}
            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": f"Not connected to {address}"}
            
            client = connected_clients[address]
            service = client.services.get_service(service_uuid)
            if service:
                chars = [c.uuid for c in service.characteristics]
                return {"status": "success", "uuids": chars}
            else:
                return {"status": "error", "message": f"Service {service_uuid} not found"}

        elif command == "read_gatt_char":
            if not address or not service_uuid or not char_uuid:
                return {"status": "error", "message": "Address, service_uuid, and char_uuid are required for read_gatt_char"}
            
            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": f"Not connected to {address}"}
            
            client = connected_clients[address]
            logging.debug(f"Reading GATT characteristic {char_uuid} from service {service_uuid} on {address}")
            value_bytes = await client.read_gatt_char(char_uuid)
            value_b64 = b64encode(value_bytes).decode('utf-8')
            logging.debug(f"Read value (base64): {value_b64}")
            return {"status": "success", "value": value_b64}

        elif command == "write_gatt_char":
            if not address or not service_uuid or not char_uuid or value_b64 is None:
                return {"status": "error", "message": "Address, service_uuid, char_uuid, and value are required for write_gatt_char"}
            
            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": f"Not connected to {address}"}
            
            logging.debug(f"Writing GATT characteristic {char_uuid} in service {service_uuid} on {address} with value (base64): {value_b64}, response: {with_response}")
            value_bytes = b64decode(value_b64.encode('utf-8'))
            await connected_clients[address].write_gatt_char(char_uuid, value_bytes, response=with_response)
            logging.debug(f"Successfully wrote value to {address}")
            return {"status": "success"}

        elif command == "start_notify":
            if not address or not service_uuid or not char_uuid:
                return {"status": "error", "message": "Address, service_uuid, and char_uuid are required for start_notify"}
            
            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": f"Not connected to {address}"}
            
            logging.debug(f"Starting notifications for GATT characteristic {char_uuid} in service {service_uuid} on {address}")
            
            def notification_handler(sender, data):
                logging.debug(f"Notification received from {sender} ({address}): {b64encode(data).decode('utf-8')}")
                send_message({
                    "event": "gatt_notification",
                    "address": address,
                    "service_uuid": service_uuid,
                    "char_uuid": char_uuid,
                    "value": b64encode(data).decode('utf-8')
                })

            if address not in notification_subscriptions:
                notification_subscriptions[address] = {}
            
            if char_uuid not in notification_subscriptions[address]:
                logging.debug(f"Subscribing to notifications for {char_uuid} on {address}")
                await connected_clients[address].start_notify(char_uuid, notification_handler)
                notification_subscriptions[address][char_uuid] = True 
                logging.debug(f"Notification started for {char_uuid} on {address}")
                return {"status": "success"}
            else:
                logging.debug(f"Already subscribed to notifications for {char_uuid} on {address}")
                return {"status": "success", "message": "Already subscribed"}

        elif command == "stop_notify":
            if not address or not service_uuid or not char_uuid:
                return {"status": "error", "message": "Address, service_uuid, and char_uuid are required for stop_notify"}
            
            if address not in connected_clients or not connected_clients[address].is_connected:
                return {"status": "error", "message": f"Not connected to {address}"}
            
            logging.debug(f"Stopping notifications for GATT characteristic {char_uuid} in service {service_uuid} on {address}")
            
            if address in notification_subscriptions and char_uuid in notification_subscriptions[address]:
                try:
                    await connected_clients[address].stop_notify(char_uuid)
                    del notification_subscriptions[address][char_uuid]
                    if not notification_subscriptions[address]: 
                        del notification_subscriptions[address]
                    logging.debug(f"Notification stopped for {char_uuid} on {address}")
                    return {"status": "success"}
                except Exception as e:
                    logging.error(f"Error stopping notification for {char_uuid} on {address}: {e}")
                    return {"status": "error", "message": f"Failed to stop notification: {e}"}
            else:
                logging.warning(f"Attempted to stop notifications for {char_uuid} on {address}, but was not subscribed.")
                return {"status": "success", "message": "Not subscribed"}

        else:
            logging.warning(f"Unknown command received: {command}")
            return {"status": "error", "message": f"Unknown command: {command}"}

    except asyncio.TimeoutError:
        logging.error("Operation timed out.")
        return {"status": "error", "message": "Operation timed out"}
    except Exception as e:
        logging.exception(f"An unexpected error occurred during command handling: {e}")
        return {"status": "error", "message": f"An unexpected error occurred: {e}"}

def get_message():
    try:
        raw_length = sys.stdin.buffer.read(4)
        if not raw_length:
            logging.info("No message length received, exiting.")
            sys.exit(0)
        message_length = struct.unpack('@I', raw_length)[0]
        message = sys.stdin.buffer.read(message_length).decode('utf-8')
        logging.debug(f"Raw message length: {message_length}, Raw message: {message[:100]}...")
        return json.loads(message)
    except Exception as e:
        logging.error(f"Error reading message: {e}")
        raise

async def main_loop():
    logging.info("Starting Native Messaging Host main loop.")
    while True:
        try:
            received_data = get_message()
            request_id = received_data.get("requestId")
            response_data = await handle_command(received_data)
            
            if request_id is not None:
                response_data["requestId"] = request_id
                
            send_message(response_data)
        except Exception as e:
            logging.exception(f"Unhandled exception in main loop: {e}")
            send_message({"status": "error", "message": f"Unhandled host error: {e}"})

if __name__ == "__main__":
    try:
        asyncio.run(main_loop())
    except KeyboardInterrupt:
        logging.info("Host process interrupted by user. Exiting.")
        sys.exit(0)
    except Exception as e:
        logging.critical(f"Fatal error during script execution: {e}")
        sys.exit(1)
