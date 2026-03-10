BINARY_SERVER = relay-server
BINARY_CLIENT = relay-client

SERVER_SRC = ./cmd/relay-server
CLIENT_SRC = ./cmd/relay-client

OUTPUT_DIR = bin

SERVER_GOOS   = linux
SERVER_GOARCH = amd64

CLIENT_GOOS   = $(shell go env GOOS)
CLIENT_GOARCH = $(shell go env GOARCH)

LDFLAGS = -s -w

.PHONY: all server client clean tidy

all: server client

server:
	@mkdir -p $(OUTPUT_DIR)
	GOOS=$(SERVER_GOOS) GOARCH=$(SERVER_GOARCH) go build -ldflags "$(LDFLAGS)" -o $(OUTPUT_DIR)/$(BINARY_SERVER) $(SERVER_SRC)
	@echo "built $(OUTPUT_DIR)/$(BINARY_SERVER) ($(SERVER_GOOS)/$(SERVER_GOARCH))"

client:
	@mkdir -p $(OUTPUT_DIR)
	GOOS=$(CLIENT_GOOS) GOARCH=$(CLIENT_GOARCH) go build -ldflags "$(LDFLAGS)" -o $(OUTPUT_DIR)/$(BINARY_CLIENT) $(CLIENT_SRC)
	@echo "built $(OUTPUT_DIR)/$(BINARY_CLIENT) ($(CLIENT_GOOS)/$(CLIENT_GOARCH))"

clean:
	rm -rf $(OUTPUT_DIR)

tidy:
	go mod tidy && go vet ./...
