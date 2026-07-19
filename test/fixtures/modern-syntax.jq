#!/usr/bin/env -S jq -nrf
# A Tcl-style continued comment. \
This entire physical line is still a comment.

def classify($input):
  $input as {$kind, value: $value}
  ?// [$kind, $value]
  | {
      kind: $kind,
      value: $value,
      expression_value: 1 + 2,
      fallback: null // 3
    };

reduce [1, 2, 3][] as $number
  (0; . + $number)
| classify(["sum", .])
