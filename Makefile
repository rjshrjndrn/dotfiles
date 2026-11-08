help: ## Prints help for targets with comments
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-25s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

secrets-get: ## Get secrets from doppler
	@doppler secrets download \
     -p lap -c shell \
     --no-file --format=env \
     | sed 's/^/export /'
secrets-set: ## Upsert secrets from stdin to doppler: cat file | make secrets-set
	@sed 's/^export //' | grep -v '^DOPPLER_' \
		| doppler secrets upload /dev/stdin -p lap -c shell --silent \
		&& echo "done" || { echo "failed" >&2; exit 1; }
