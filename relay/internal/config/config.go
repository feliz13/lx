package config

import (
	"encoding/json"
	"fmt"
	"os"
)

type AccountConfig struct {
	AppId             string `json:"appId"`
	AppSecret         string `json:"appSecret"`
	GatewayUrl        string `json:"gatewayUrl"`
	CallbackKey       string `json:"callbackKey"`
	CallbackSignToken string `json:"callbackSignToken"`
}

type ServerConfig struct {
	Secret   string                    `json:"secret"`
	HttpAddr string                    `json:"httpAddr"`
	WsAddr   string                    `json:"wsAddr"`
	Accounts map[string]*AccountConfig `json:"accounts"`
}

func Load(path string) (*ServerConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	var cfg ServerConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	if cfg.Secret == "" {
		cfg.Secret = "lx-relay-s3cret!"
	}
	if cfg.HttpAddr == "" {
		cfg.HttpAddr = ":8088"
	}
	if cfg.WsAddr == "" {
		cfg.WsAddr = ":8087"
	}
	if len(cfg.Accounts) == 0 {
		return nil, fmt.Errorf("no accounts configured")
	}
	for name, acc := range cfg.Accounts {
		if acc.CallbackKey == "" || acc.CallbackSignToken == "" {
			return nil, fmt.Errorf("account %q: callbackKey and callbackSignToken are required", name)
		}
		if acc.AppId == "" || acc.AppSecret == "" || acc.GatewayUrl == "" {
			return nil, fmt.Errorf("account %q: appId, appSecret and gatewayUrl are required", name)
		}
	}
	return &cfg, nil
}
