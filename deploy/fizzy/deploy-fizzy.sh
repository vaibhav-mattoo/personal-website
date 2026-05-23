#!/usr/bin/env bash
# Wrapper for Kamal lifecycle commands. Run from your Fizzy fork after
# symlinking: ln -s ../personal-website/deploy/fizzy/deploy-fizzy.sh ./deploy.sh
set -euo pipefail

cmd="${1:-deploy}"

[[ -f .kamal/secrets ]] || {
	echo ".kamal/secrets missing — see deploy/fizzy/README.md" >&2
	exit 1
}
[[ -f config/deploy.yml ]] || {
	echo "config/deploy.yml missing — see deploy/fizzy/README.md" >&2
	exit 1
}

case "$cmd" in
setup) bin/kamal setup ;;
deploy) bin/kamal deploy ;;
logs) bin/kamal app logs -f ;;
ssh) bin/kamal app exec --interactive --reuse bash ;;
restart) bin/kamal app boot ;;
remove)
	read -p "This removes Fizzy entirely. Type 'remove' to confirm: " c
	[[ "$c" == "remove" ]] && bin/kamal app remove
	;;
*)
	echo "Usage: $0 [setup|deploy|logs|ssh|restart|remove]" >&2
	exit 1
	;;
esac
