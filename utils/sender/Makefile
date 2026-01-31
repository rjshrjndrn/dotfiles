timeout ?= 10

.PHONY: dev deploy login
help: ## Prints help for targets with comments
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-25s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

dev: ## dev env
	npx wrangler dev

deploy: ## Deploy to CF (use timeout=30 to override)
	npx wrangler deploy --var TIMEOUT_SECONDS:$(timeout)

login: ## Login to cloudflare
	npx wrangler login
