{{PID_PREFIX}}
__events={{EVENTS_FILE}}
__id={{ID}}

__emit() {
  echo '{"ts":'$(date +%s000)',"type":"result","id":"'"$__id"'","action":"'"$1"'"}' >> "$__events"
}

trap '__emit cancel' EXIT INT TERM HUP

{{COMMAND}}
code=$?

if [ $code -eq 0 ]; then __emit accept; else __emit decline; fi
trap - EXIT INT TERM HUP
