package lanxin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"

	"lx-relay/internal/config"
)

type tokenEntry struct {
	token     string
	expiresAt time.Time
}

var (
	tokenCacheMu sync.Mutex
	tokenCache   = map[string]*tokenEntry{}
)

func GetAppToken(account *config.AccountConfig) (string, error) {
	cacheKey := account.AppId

	tokenCacheMu.Lock()
	entry, ok := tokenCache[cacheKey]
	if ok && time.Now().Add(time.Minute).Before(entry.expiresAt) {
		token := entry.token
		tokenCacheMu.Unlock()
		return token, nil
	}
	tokenCacheMu.Unlock()

	gw := account.GatewayUrl
	u := fmt.Sprintf("%s/v1/apptoken/create?grant_type=client_credential&appid=%s&secret=%s",
		gw,
		url.QueryEscape(account.AppId),
		url.QueryEscape(account.AppSecret),
	)

	resp, err := http.Get(u)
	if err != nil {
		return "", fmt.Errorf("request token: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	var result struct {
		ErrCode int    `json:"errCode"`
		ErrMsg  string `json:"errMsg"`
		Data    *struct {
			AppToken  string `json:"appToken"`
			ExpiresIn int    `json:"expiresIn"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("parse token response: %w", err)
	}
	if result.ErrCode != 0 || result.Data == nil || result.Data.AppToken == "" {
		return "", fmt.Errorf("get token failed: errCode=%d errMsg=%s", result.ErrCode, result.ErrMsg)
	}

	expiresIn := result.Data.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 7200
	}

	tokenCacheMu.Lock()
	tokenCache[cacheKey] = &tokenEntry{
		token:     result.Data.AppToken,
		expiresAt: time.Now().Add(time.Duration(expiresIn) * time.Second),
	}
	tokenCacheMu.Unlock()

	return result.Data.AppToken, nil
}

func SendPrivateMessage(account *config.AccountConfig, token, userId, text string) error {
	gw := account.GatewayUrl
	u := fmt.Sprintf("%s/v1/bot/messages/create?app_token=%s", gw, url.QueryEscape(token))

	payload := map[string]any{
		"userIdList": []string{userId},
		"msgType":    "text",
		"msgData": map[string]any{
			"text": map[string]any{
				"content": text,
			},
		},
	}

	return doPost(u, payload)
}

func SendGroupMessage(account *config.AccountConfig, token, groupId, text string) error {
	gw := account.GatewayUrl
	u := fmt.Sprintf("%s/v1/messages/group/create?app_token=%s", gw, url.QueryEscape(token))

	payload := map[string]any{
		"groupId": groupId,
		"msgType": "text",
		"msgData": map[string]any{
			"text": map[string]any{
				"content": text,
			},
		},
	}

	return doPost(u, payload)
}

func doPost(u string, payload any) error {
	data, _ := json.Marshal(payload)
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Post(u, "application/json", bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("post: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	var result struct {
		ErrCode int    `json:"errCode"`
		ErrMsg  string `json:"errMsg"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return fmt.Errorf("parse response: %w (body: %s)", err, string(body[:min(len(body), 200)]))
	}
	if result.ErrCode != 0 {
		return fmt.Errorf("errCode=%d errMsg=%s", result.ErrCode, result.ErrMsg)
	}
	return nil
}
