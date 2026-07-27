SHELL := /usr/bin/env bash

PREFIX ?= $(HOME)/.local/bin
SANDBOX := pi-sandbox

.PHONY: test test-dryrun test-live test-extra test-dns install uninstall help

help:
	@echo "targets:"
	@echo "  test        run all specs (dry-run, live, extra-mounts, dns)"
	@echo "  test-dryrun run the dry-run boundary spec"
	@echo "  test-live   run the live sandbox probe"
	@echo "  test-extra  run the extra-mounts spec"
	@echo "  test-dns    run the DNS resolution spec"
	@echo "  install     symlink $(SANDBOX) into $(PREFIX)"
	@echo "  uninstall   remove the symlink from $(PREFIX)"

test: test-dryrun test-live test-extra test-dns

test-dryrun:
	@bash tests/test_dryrun.sh

test-live:
	@bash tests/test_live.sh

test-extra:
	@bash tests/test_extra_mounts.sh

test-dns:
	@bash tests/test_dns.sh

install:
	@mkdir -p "$(PREFIX)"
	@ln -sf "$(CURDIR)/$(SANDBOX)" "$(PREFIX)/$(SANDBOX)"
	@echo "linked $(PREFIX)/$(SANDBOX) -> $(CURDIR)/$(SANDBOX)"

uninstall:
	@rm -f "$(PREFIX)/$(SANDBOX)"
	@echo "removed $(PREFIX)/$(SANDBOX)"
