help: ## Prints help for targets with comments
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-25s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

download-updater: ## download latest updater script
	wget https://raw.githubusercontent.com/arkenfox/user.js/refs/heads/master/updater.sh
update: ## Update arkenfox
	./updater.sh -s -c -o ${PWD}/user-overrides.js -p /home/skynet/.config/mozilla/firefox/cavlven7.default-release/
	git clean -fd && git clean -fdX
