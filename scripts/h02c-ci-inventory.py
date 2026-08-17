import hashlib
import json
import os
import platform
import re
import stat
import sys


ENVIRONMENT = {
    "PATH": "/usr/bin:/bin",
    "LANG": "C",
    "LC_ALL": "C",
    "TZ": "UTC",
    "__CF_USER_TEXT_ENCODING": "0x1F5:0x0:0x0",
}
INTERPRETER = "/Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9"
H02C_REPLACED = [
    "ci/installed-license-evidence.json",
    "ci/tool-payload-inventory.json",
    "ci/trust-baseline.json",
]
H11B_REPLACED = [
    "ci/generated/sbom.cdx.json",
    "ci/installed-license-evidence.json",
    "ci/tool-payload-inventory.json",
    "ci/trust-baseline.json",
]
H11B_CREATED = "ci/generated/provenance/H11B-PROV-R51-001.json"
PROFILES = {"h02c": (H02C_REPLACED, None), "h11b": (H11B_REPLACED, H11B_CREATED)}
RECORD_KEYS = [
    "path",
    "type",
    "dev",
    "ino",
    "mode",
    "nlink",
    "size",
    "mtimeNs",
    "ctimeNs",
    "sha256",
]
LIMITATIONS = [
    "LOCAL_UNSIGNED_UNAUTHENTICATED_BUILD_EVIDENCE_ONLY",
    "HOSTILE_LOCAL_ACTOR_RISK_OPEN",
    "FABRICATED_STRUCTURALLY_VALID_STDIN_MAY_PASS",
    "PREIMAGE_CAPTURE_SESSION_AUTHENTICITY_UNPROVEN",
]
MAX_INPUT = 1048576
FLAGS = os.O_RDONLY | os.O_NOFOLLOW


def fail():
    os._exit(70)


def identity(value):
    if stat.S_ISDIR(value.st_mode):
        kind = "directory"
    elif stat.S_ISREG(value.st_mode):
        kind = "regular"
    else:
        fail()
    values = [
        value.st_dev,
        value.st_ino,
        value.st_nlink,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    ]
    if any(not isinstance(item, int) or item < 0 for item in values):
        fail()
    return (
        kind,
        value.st_dev,
        value.st_ino,
        stat.S_IMODE(value.st_mode),
        value.st_nlink,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    )


def record(relative, value, content_hash):
    observed = identity(value)
    return {
        "path": relative,
        "type": observed[0],
        "dev": str(observed[1]),
        "ino": str(observed[2]),
        "mode": format(observed[3], "04o"),
        "nlink": str(observed[4]),
        "size": str(observed[5]),
        "mtimeNs": str(observed[6]),
        "ctimeNs": str(observed[7]),
        "sha256": content_hash,
    }


def component(name):
    if (
        not isinstance(name, str)
        or not name
        or name in (".", "..")
        or "/" in name
        or "\\" in name
        or name.encode("utf-8").decode("utf-8") != name
    ):
        fail()
    return name


def read_regular(parent_fd, parent_identity, name, listed):
    if listed.st_nlink != 1:
        fail()
    handle = os.open(name, FLAGS, dir_fd=parent_fd)
    try:
        before = os.fstat(handle)
        if identity(before) != identity(listed) or identity(before)[0] != "regular":
            fail()
        digest = hashlib.sha256()
        total = 0
        while True:
            chunk = os.read(handle, 65536)
            if not chunk:
                break
            total += len(chunk)
            digest.update(chunk)
        after = os.fstat(handle)
        rebound = os.lstat(name, dir_fd=parent_fd)
        if (
            total != before.st_size
            or identity(after) != identity(before)
            or identity(rebound) != identity(before)
            or identity(os.fstat(parent_fd)) != parent_identity
        ):
            fail()
        return digest.hexdigest()
    finally:
        os.close(handle)


def walk_directory(parent_fd, parent_identity, name, relative, root_device, records, identities):
    listed = os.lstat(name, dir_fd=parent_fd)
    if identity(listed)[0] != "directory" or listed.st_dev != root_device:
        fail()
    handle = os.open(name, FLAGS | os.O_DIRECTORY, dir_fd=parent_fd)
    try:
        before = os.fstat(handle)
        current = identity(before)
        if current != identity(listed) or identity(os.fstat(parent_fd)) != parent_identity:
            fail()
        key = (before.st_dev, before.st_ino)
        if key in identities:
            fail()
        identities.add(key)
        records.append(record(relative, before, None))
        names = os.listdir(handle)
        if len(names) != len(set(names)):
            fail()
        for child_name in sorted((component(item) for item in names), key=lambda item: item.encode("utf-8")):
            child_relative = relative + "/" + child_name
            child = os.lstat(child_name, dir_fd=handle)
            if child.st_dev != root_device:
                fail()
            child_kind = identity(child)[0]
            if child_kind == "directory":
                walk_directory(
                    handle,
                    current,
                    child_name,
                    child_relative,
                    root_device,
                    records,
                    identities,
                )
            else:
                key = (child.st_dev, child.st_ino)
                if key in identities:
                    fail()
                identities.add(key)
                content_hash = read_regular(handle, current, child_name, child)
                records.append(record(child_relative, child, content_hash))
        rebound = os.lstat(name, dir_fd=parent_fd)
        if (
            identity(os.fstat(handle)) != current
            or identity(rebound) != current
            or identity(os.fstat(parent_fd)) != parent_identity
        ):
            fail()
    finally:
        os.close(handle)


def collect():
    if os.getcwd() != os.path.realpath(os.getcwd()):
        fail()
    root_listed = os.lstat(".")
    root_fd = os.open(".", FLAGS | os.O_DIRECTORY)
    try:
        root_identity = identity(os.fstat(root_fd))
        if root_identity != identity(root_listed):
            fail()
        records = []
        identities = {(root_listed.st_dev, root_listed.st_ino)}
        walk_directory(
            root_fd,
            root_identity,
            "ci",
            "ci",
            root_listed.st_dev,
            records,
            identities,
        )
        if identity(os.fstat(root_fd)) != root_identity or identity(os.lstat(".")) != root_identity:
            fail()
    finally:
        os.close(root_fd)
    records.sort(key=lambda item: item["path"].encode("utf-8"))
    rendered = json.dumps(records, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return {
        "records": records,
        "count": len(records),
        "aggregate": hashlib.sha256(rendered).hexdigest(),
    }


def valid_inventory(value):
    if not isinstance(value, dict) or list(value) != ["records", "count", "aggregate"]:
        fail()
    records = value["records"]
    if (
        not isinstance(records, list)
        or value["count"] != len(records)
        or not isinstance(value["aggregate"], str)
        or re.fullmatch(r"[0-9a-f]{64}", value["aggregate"]) is None
    ):
        fail()
    paths = []
    for item in records:
        if not isinstance(item, dict) or list(item) != RECORD_KEYS:
            fail()
        if item["type"] not in ("directory", "regular"):
            fail()
        if item["type"] == "directory" and item["sha256"] is not None:
            fail()
        if item["type"] == "regular" and (
            not isinstance(item["sha256"], str)
            or re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) is None
        ):
            fail()
        if re.fullmatch(r"[0-9]+", item["dev"]) is None:
            fail()
        if re.fullmatch(r"[0-9]+", item["ino"]) is None:
            fail()
        if re.fullmatch(r"[0-7]{4}", item["mode"]) is None:
            fail()
        for key in ("nlink", "size", "mtimeNs", "ctimeNs"):
            if re.fullmatch(r"[0-9]+", item[key]) is None:
                fail()
        paths.append(item["path"])
    if paths != sorted(paths, key=lambda item: item.encode("utf-8")) or len(paths) != len(set(paths)):
        fail()
    rendered = json.dumps(records, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if hashlib.sha256(rendered).hexdigest() != value["aggregate"]:
        fail()


def compare(before, after, profile):
    valid_inventory(before)
    valid_inventory(after)
    replaced, created = PROFILES[profile]
    left = {item["path"]: item for item in before["records"]}
    right = {item["path"]: item for item in after["records"]}
    expected_right = set(left)
    if created is not None:
        expected_right.add(created)
    if set(right) != expected_right or after["count"] != before["count"] + int(created is not None):
        fail()
    changed = []
    mutable_fields = {"size", "mtimeNs", "ctimeNs", "sha256"}
    for relative in left:
        differing = {key for key in RECORD_KEYS if left[relative][key] != right[relative][key]}
        if relative in replaced:
            if not differing.issubset(mutable_fields):
                fail()
            if differing:
                changed.append(relative)
        elif profile == "h11b" and relative == "ci/generated/provenance":
            if (
                any(left[relative][key] != right[relative][key] for key in ("path", "type", "dev", "ino", "mode", "sha256"))
                or left[relative]["type"] != "directory"
                or int(right[relative]["nlink"]) != int(left[relative]["nlink"]) + 1
                or int(right[relative]["size"]) != int(left[relative]["size"]) + 32
                or left[relative]["mtimeNs"] == right[relative]["mtimeNs"]
                or left[relative]["ctimeNs"] == right[relative]["ctimeNs"]
            ):
                fail()
        elif differing:
            fail()
    if created is not None:
        created_record = right[created]
        if (
            created_record["type"] != "regular"
            or created_record["mode"] != "0644"
            or created_record["nlink"] != "1"
        ):
            fail()
        changed.append(created)
    changed.sort(key=lambda item: item.encode("utf-8"))
    expected = sorted(replaced + ([] if created is None else [created]), key=lambda item: item.encode("utf-8"))
    if changed != expected:
        fail()
    return changed


def main():
    if dict(os.environ) != ENVIRONMENT:
        fail()
    if sys.executable != INTERPRETER:
        fail()
    if platform.python_implementation() != "CPython" or sys.version_info[:3] != (3, 9, 6):
        fail()
    if len(sys.argv) != 4 or sys.argv[:2] != ["-c", "--"]:
        fail()
    source_digest = sys.argv[2]
    profile = sys.argv[3]
    if re.fullmatch(r"[0-9a-f]{64}", source_digest) is None or profile not in PROFILES:
        fail()
    supplied = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(supplied) > MAX_INPUT:
        fail()
    inventory = collect()
    if not supplied:
        result = {
            "schema": "H02C_CI_INVENTORY_V1",
            "profile": profile,
            "heldSourceSha256": source_digest,
            "mode": "capture",
            "limitations": LIMITATIONS,
            "inventory": inventory,
        }
    else:
        try:
            decoded = supplied.decode("utf-8")
            captured = json.loads(decoded)
        except (UnicodeDecodeError, json.JSONDecodeError):
            fail()
        if json.dumps(captured, ensure_ascii=False, separators=(",", ":")) != decoded:
            fail()
        if (
            not isinstance(captured, dict)
            or list(captured) != ["schema", "profile", "heldSourceSha256", "mode", "limitations", "inventory"]
            or captured["schema"] != "H02C_CI_INVENTORY_V1"
            or captured["profile"] != profile
            or captured["heldSourceSha256"] != source_digest
            or captured["mode"] != "capture"
            or captured["limitations"] != LIMITATIONS
        ):
            fail()
        changed = compare(captured["inventory"], inventory, profile)
        result = {
            "schema": "H02C_CI_INVENTORY_V1",
            "profile": profile,
            "heldSourceSha256": source_digest,
            "mode": "compare",
            "limitations": LIMITATIONS,
            "changedTargets": changed,
            "inventory": inventory,
        }
    output = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(output) > 1048576:
        fail()
    sys.stdout.buffer.write(output)
    sys.stdout.buffer.flush()


try:
    main()
except BaseException:
    fail()
