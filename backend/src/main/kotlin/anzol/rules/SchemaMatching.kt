package anzol.rules

import anzol.schema.SchemaResult
import anzol.schema.SchemaState

/** `schema: expected valid, got invalid (3 errors)`; sem schema configurado, `got not configured`. */
fun schemaFailure(
    expected: SchemaState,
    actual: SchemaResult?,
): String? {
    val got =
        when {
            actual == null -> "not configured"
            actual.valid -> actual.state().id
            else -> "${actual.state().id} (${actual.errors.size} errors)"
        }
    return "schema: expected ${expected.id}, got $got".takeUnless { actual?.state() == expected }
}
