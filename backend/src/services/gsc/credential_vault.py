"""RockBase GSC-only Windows Credential Manager bridge. Secrets use stdin/stdout, never argv/files."""
import ctypes
from ctypes import wintypes
import json
import re
import sys


def main():
    if sys.platform != "win32":
        raise RuntimeError("Windows Credential Manager is required; plaintext fallback is disabled")
    payload = json.loads(sys.stdin.read(16384))
    target = payload.get("target", "")
    if not re.fullmatch(r"RockBase/GSC/v1/[a-f0-9]{32}/(client|tokens|service_account|probe-[a-f0-9]{16})", target):
        raise ValueError("Invalid credential namespace")

    class CREDENTIAL(ctypes.Structure):
        _fields_ = [
            ("Flags", wintypes.DWORD), ("Type", wintypes.DWORD),
            ("TargetName", wintypes.LPWSTR), ("Comment", wintypes.LPWSTR),
            ("LastWritten", wintypes.FILETIME), ("CredentialBlobSize", wintypes.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)), ("Persist", wintypes.DWORD),
            ("AttributeCount", wintypes.DWORD), ("Attributes", ctypes.c_void_p),
            ("TargetAlias", wintypes.LPWSTR), ("UserName", wintypes.LPWSTR),
        ]

    dll = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
    dll.CredWriteW.argtypes = [ctypes.POINTER(CREDENTIAL), wintypes.DWORD]
    dll.CredWriteW.restype = wintypes.BOOL
    dll.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.POINTER(CREDENTIAL))]
    dll.CredReadW.restype = wintypes.BOOL
    dll.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
    dll.CredDeleteW.restype = wintypes.BOOL
    dll.CredFree.argtypes = [ctypes.c_void_p]
    operation = payload.get("operation")
    result = None
    if operation == "write":
        raw = payload["value"].encode("utf-8")
        if len(raw) > 2560:
            raise ValueError("Credential payload exceeds Windows limit")
        blob = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
        cred = CREDENTIAL()
        cred.Type, cred.TargetName, cred.Persist = 1, target, 2
        cred.UserName, cred.Comment = "RockBase local operator", "GSC Desktop OAuth; isolated per installation"
        cred.CredentialBlobSize = len(raw)
        cred.CredentialBlob = ctypes.cast(blob, ctypes.POINTER(ctypes.c_ubyte))
        if not dll.CredWriteW(ctypes.byref(cred), 0):
            raise RuntimeError("Credential write failed")
        result = True
    elif operation == "read":
        pointer = ctypes.POINTER(CREDENTIAL)()
        if dll.CredReadW(target, 1, 0, ctypes.byref(pointer)):
            try:
                result = ctypes.string_at(pointer.contents.CredentialBlob, pointer.contents.CredentialBlobSize).decode("utf-8")
            finally:
                dll.CredFree(pointer)
        elif ctypes.get_last_error() != 1168:
            raise RuntimeError("Credential read failed")
    elif operation == "delete":
        if not dll.CredDeleteW(target, 1, 0) and ctypes.get_last_error() != 1168:
            raise RuntimeError("Credential delete failed")
        result = True
    else:
        raise ValueError("Unsupported operation")
    sys.stdout.write(json.dumps({"ok": True, "value": result}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never echo request, credential payload, exception repr or Windows context.
        sys.stdout.write(json.dumps({"ok": False, "error": "OS credential storage unavailable; no plaintext fallback"}))
        sys.exit(1)
