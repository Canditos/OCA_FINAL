#!/usr/bin/env python3
"""
OCPP Certification Dashboard Launcher
Starts the dashboard server and opens the browser automatically.
"""

import subprocess
import webbrowser
import signal
import sys
import os
import time
import socket

PORT = 3101
URL = f"http://localhost:{PORT}"
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))

server_process = None

def is_port_open(port):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            return s.connect_ex(("127.0.0.1", port)) == 0
    except:
        return False

def cleanup(signum=None, frame=None):
    global server_process
    if server_process:
        print("[Launcher] Stopping server...")
        server_process.terminate()
        try:
            server_process.wait(timeout=5)
        except:
            server_process.kill()
    print("[Launcher] Done.")
    sys.exit(0)

def main():
    global server_process

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    print("=" * 50)
    print("  OCPP Certification Pipeline Dashboard")
    print("=" * 50)

    # Check if already running
    if is_port_open(PORT):
        print(f"[Launcher] Dashboard already running on {URL}")
        webbrowser.open(URL)
        return

    # Start server
    print(f"[Launcher] Starting server on port {PORT}...")
    server_process = subprocess.Popen(
        ["npx", "tsx", "src/apps/certification-dashboard/server.ts"],
        cwd=PROJECT_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        shell=True,
    )

    # Wait for server to be ready
    for i in range(30):
        if is_port_open(PORT):
            break
        time.sleep(1)
        if server_process.poll() is not None:
            print("[Launcher] Server failed to start!")
            sys.exit(1)
    else:
        print("[Launcher] Timeout waiting for server!")
        cleanup()

    print(f"[Launcher] Dashboard ready at {URL}")
    webbrowser.open(URL)
    print("[Launcher] Press Ctrl+C to stop.\n")

    # Stream server output
    try:
        for line in server_process.stdout:
            decoded = line.decode("utf-8", errors="replace").rstrip()
            if decoded:
                print(decoded)
    except KeyboardInterrupt:
        pass
    finally:
        cleanup()

if __name__ == "__main__":
    main()
