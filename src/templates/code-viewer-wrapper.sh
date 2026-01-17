{{PID_PREFIX}}
__events={{EVENTS_FILE}}
__id={{ID}}
__file={{FILE}}
__action_file="/tmp/termos-action-${__id}.json"
__sent=0

__emit() {
  action=$1
  result=$2
  if [ "$__sent" -eq 0 ]; then
    __sent=1
    if [ -n "$result" ]; then
      echo '{"ts":'$(date +%s000)',"type":"result","id":"'"$__id"'","action":"'"$action"'","result":'"$result"'}' >> "$__events"
    else
      echo '{"ts":'$(date +%s000)',"type":"result","id":"'"$__id"'","action":"'"$action"'"}' >> "$__events"
    fi
  fi
}

__cleanup() {
  rm -f "$__action_file"
}

trap '__cleanup; __emit cancel' EXIT INT TERM HUP

# Loop: viewer -> editor -> viewer -> ...
while true; do
  # Clear any previous action file
  rm -f "$__action_file"

  # Run the Ink code viewer
  {{NODE_CMD}} {{INK_RUNNER}} --file {{CODE_COMPONENT}} --args '{{ARGS}}'

  # Check if action file exists (viewer wrote its exit action)
  if [ -f "$__action_file" ]; then
    # Extract action, line, and editorCmd from JSON
    __action=$(grep -o '"action":"[^"]*"' "$__action_file" 2>/dev/null | cut -d'"' -f4)
    __line=$(grep -o '"line":[0-9]*' "$__action_file" 2>/dev/null | cut -d':' -f2)
    __editor_cmd=$(grep -o '"editorCmd":"[^"]*"' "$__action_file" 2>/dev/null | cut -d'"' -f4)
    __line=${__line:-1}

    if [ "$__action" = "edit" ] && [ -n "$__editor_cmd" ]; then
      # Replace {line} and {file} placeholders in editor command
      __cmd=$(echo "$__editor_cmd" | sed "s/{line}/$__line/g" | sed "s|{file}|$__file|g")

      # Execute: if command doesn't contain the file path, append it
      if echo "$__cmd" | grep -q "$__file"; then
        eval $__cmd
      else
        eval $__cmd '"$__file"'
      fi

      # After editing, loop back to show viewer again
      continue
    fi

    # Normal exit (accept) - emit result and break
    if [ "$__action" = "accept" ]; then
      __emit accept '{"file":"'"$__file"'"}'
      trap - EXIT INT TERM HUP
      __cleanup
      exit 0
    fi
  fi

  # If no action file or unknown action, break the loop
  break
done

__cleanup
