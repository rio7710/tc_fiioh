from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


class JsonSchemaError(ValueError):
    pass


def _resolve(root: dict[str, Any], reference: str) -> dict[str, Any]:
    if not reference.startswith("#/"):
        raise JsonSchemaError(f"unsupported schema reference: {reference}")
    value: Any = root
    for part in reference[2:].split("/"):
        value = value[part.replace("~1", "/").replace("~0", "~")]
    return value


def _matches_type(value: Any, expected: str) -> bool:
    return {
        "null": value is None,
        "object": isinstance(value, dict),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "boolean": isinstance(value, bool),
    }.get(expected, False)


def validate_json_schema(value: Any, schema: dict[str, Any], root: dict[str, Any] | None = None,
                         path: str = "$") -> None:
    root = root or schema
    if "$ref" in schema:
        validate_json_schema(value, _resolve(root, schema["$ref"]), root, path)
        return
    if "oneOf" in schema:
        matches = 0
        errors = []
        for candidate in schema["oneOf"]:
            try:
                validate_json_schema(value, candidate, root, path)
                matches += 1
            except JsonSchemaError as exc:
                errors.append(str(exc))
        if matches != 1:
            detail = errors[-1] if errors else "no matching branch"
            raise JsonSchemaError(f"{path}: expected exactly one schema match; {detail}")
        return
    expected = schema.get("type")
    if expected:
        types = expected if isinstance(expected, list) else [expected]
        if not any(_matches_type(value, item) for item in types):
            raise JsonSchemaError(f"{path}: expected {' or '.join(types)}")
    if "const" in schema and value != schema["const"]:
        raise JsonSchemaError(f"{path}: value must equal {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        actual = repr(value)
        if len(actual) > 120:
            actual = actual[:117] + "..."
        allowed = ", ".join(repr(item) for item in schema["enum"])
        raise JsonSchemaError(f"{path}: value {actual} is not in enum [{allowed}]")
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        missing = [key for key in schema.get("required", []) if key not in value]
        if missing:
            raise JsonSchemaError(f"{path}: missing required fields {', '.join(missing)}")
        if schema.get("additionalProperties") is False:
            extras = [key for key in value if key not in properties]
            if extras:
                raise JsonSchemaError(f"{path}: unexpected fields {', '.join(extras)}")
        for key, item in value.items():
            if key in properties:
                validate_json_schema(item, properties[key], root, f"{path}.{key}")
    if isinstance(value, list):
        if len(value) < int(schema.get("minItems", 0)):
            raise JsonSchemaError(f"{path}: too few items")
        if "maxItems" in schema and len(value) > int(schema["maxItems"]):
            raise JsonSchemaError(f"{path}: too many items")
        if schema.get("uniqueItems"):
            encoded = [json.dumps(item, ensure_ascii=False, sort_keys=True) for item in value]
            if len(encoded) != len(set(encoded)):
                raise JsonSchemaError(f"{path}: items must be unique")
        if "items" in schema:
            for index, item in enumerate(value):
                validate_json_schema(item, schema["items"], root, f"{path}[{index}]")
    if isinstance(value, str):
        if len(value) < int(schema.get("minLength", 0)):
            raise JsonSchemaError(f"{path}: string is too short")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            raise JsonSchemaError(f"{path}: string does not match pattern")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            raise JsonSchemaError(f"{path}: value is below minimum")
        if "maximum" in schema and value > schema["maximum"]:
            raise JsonSchemaError(f"{path}: value is above maximum")
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            raise JsonSchemaError(f"{path}: value must be greater than minimum")


def validate_json_schema_file(value: Any, path: str | Path) -> None:
    schema = json.loads(Path(path).read_text(encoding="utf-8"))
    validate_json_schema(value, schema)
