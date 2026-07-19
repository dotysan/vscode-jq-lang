#! /usr/bin/env -S make -f
PYVER := 3.14.6
VB = .venv/bin
UV_BIN := $(shell command -v uv 2>/dev/null)
VSIX := $(shell jq --raw-output '"\(.name)-\(.version).vsix"' package.json)
TS_SOURCES := $(shell find src -type f -name '*.ts')
GRAMMAR_FILES := $(shell find syntaxes -type f)

$(VSIX): out/extension.js package.json README.md LICENSE \
	    language-configuration.json .vscodeignore $(GRAMMAR_FILES)
	@uv run npx vsce package --out $@

out/extension.js: $(TS_SOURCES) tsconfig.json node_modules/.installed
	@uv run npm run compile

node_modules/.installed: package.json package-lock.json |$(VB)/npm
	@uv run npm ci --omit=optional
	@touch $@

$(VB)/npm: |$(VB)/nodeenv
	@uv run nodeenv --python-virtualenv --node=lts && \
	touch --reference=$(VB)/activate.csh $(VB)/activate && \
	uv run npm install --global npm

$(VB)/nodeenv: |$(VB)/activate
	@uv pip install nodeenv

$(VB)/activate: |uv
	@uv venv --managed-python --python=$(PYVER)

.PHONY: uv
uv:
ifeq ($(UV_BIN),)
	@curl --location https://doty.org/gist/uv-install |bash
endif

.PHONY: clean
clean:
	rm --recursive --force .venv node_modules out *.vsix*
