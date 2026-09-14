if [[ -n "${_RAMBLA_ZSH_INTEGRATION_LOADED-}" ]]; then
  return
fi
typeset -g _RAMBLA_ZSH_INTEGRATION_LOADED=1

autoload -Uz add-zsh-hook

typeset -g _RAMBLA_ZSH_COMMAND_ACTIVE=0

function _rambla_osc633() {
  printf '\e]633;%s\a' "$1"
}

function _rambla_precmd() {
  local command_status=$?
  if [[ "$_RAMBLA_ZSH_COMMAND_ACTIVE" == "1" ]]; then
    _rambla_osc633 "D;${command_status}"
    _RAMBLA_ZSH_COMMAND_ACTIVE=0
  fi
  printf '\e]2;%s\a' "${PWD/#$HOME/~}"
  _rambla_osc633 "A"
}

function _rambla_preexec() {
  _RAMBLA_ZSH_COMMAND_ACTIVE=1
  _rambla_osc633 "B"
  _rambla_osc633 "C"
  printf '\e]2;%s\a' "$1"
}

add-zsh-hook precmd _rambla_precmd
add-zsh-hook preexec _rambla_preexec
