package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
)

func VerifySignature(signToken, timestamp, nonce, dataEncrypt, expectedSignature string) bool {
	params := []string{signToken, timestamp, nonce, dataEncrypt}
	sort.Strings(params)
	concat := strings.Join(params, "")
	h := sha1.New()
	h.Write([]byte(concat))
	hash := hex.EncodeToString(h.Sum(nil))
	return hash == strings.ToLower(expectedSignature)
}

// DecryptPayload decrypts a Lanxin callback dataEncrypt field.
//
// Binary format after AES decrypt: random(16B) + contentLen(4B) + content
// Content contains orgId + appId prefix followed by JSON.
// We skip the 20-byte header, find the first '{', and extract the first
// complete JSON object (brace-matched) to handle any trailing bytes.
func DecryptPayload(dataEncrypt, aesKey string) (string, error) {
	ciphertext, err := base64.StdEncoding.DecodeString(dataEncrypt)
	if err != nil {
		return "", fmt.Errorf("base64 decode ciphertext: %w", err)
	}
	if len(ciphertext) < 16 {
		return "", fmt.Errorf("ciphertext too short")
	}

	keyBytes, err := base64.StdEncoding.DecodeString(aesKey + "=")
	if err != nil {
		return "", fmt.Errorf("base64 decode key: %w", err)
	}
	if len(keyBytes) < 32 {
		return "", fmt.Errorf("invalid aes key length")
	}

	key := keyBytes[:32]
	iv := key[:16]

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}

	mode := cipher.NewCBCDecrypter(block, iv)
	decrypted := make([]byte, len(ciphertext))
	mode.CryptBlocks(decrypted, ciphertext)

	padLen := int(decrypted[len(decrypted)-1])
	if padLen < 1 || padLen > aes.BlockSize {
		return "", fmt.Errorf("invalid PKCS7 padding: %d", padLen)
	}
	decrypted = decrypted[:len(decrypted)-padLen]

	if len(decrypted) < 21 {
		return "", fmt.Errorf("decrypted payload too short (%d bytes)", len(decrypted))
	}

	rest := string(decrypted[20:])
	jsonStart := strings.Index(rest, "{")
	if jsonStart == -1 {
		return "", fmt.Errorf("no JSON object found in decrypted payload")
	}

	result, err := extractFirstJsonObject(rest[jsonStart:])
	if err != nil {
		return "", err
	}
	return result, nil
}

// extractFirstJsonObject extracts the first complete JSON object from a string
// using brace depth matching. Handles nested objects and string escaping.
func extractFirstJsonObject(s string) (string, error) {
	depth := 0
	inString := false
	escape := false
	var quote byte

	for i := 0; i < len(s); i++ {
		c := s[i]
		if escape {
			escape = false
			continue
		}
		if inString {
			if c == '\\' {
				escape = true
			} else if c == quote {
				inString = false
			}
			continue
		}
		if c == '"' || c == '\'' {
			inString = true
			quote = c
			continue
		}
		if c == '{' {
			depth++
			continue
		}
		if c == '}' {
			depth--
			if depth == 0 {
				return s[:i+1], nil
			}
		}
	}
	return "", fmt.Errorf("incomplete JSON object")
}
