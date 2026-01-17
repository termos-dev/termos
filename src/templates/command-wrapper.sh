{{PID_PREFIX}}
__events={{EVENTS_FILE}}
__id={{ID}}
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

trap '__emit cancel' EXIT INT TERM HUP

{{COMMAND}}
code=$?

echo ''
if [ $code -eq 0 ]; then echo '✓ Command completed successfully'; else echo '✗ Command failed (exit code: '$code')'; fi
echo 'Files may have changed.'
echo ''
echo 'Press Enter to close...'
read __dummy

if [ $code -eq 0 ]; then __emit accept '{"exitCode":'$code'}'; else __emit decline '{"exitCode":'$code'}'; fi
trap - EXIT INT TERM HUP
