package protocol

const (
	MsgTypeAuth         = "auth"
	MsgTypeAuthOK       = "auth_ok"
	MsgTypeAuthFail     = "auth_fail"
	MsgTypeHTTPRequest  = "http_request"
	MsgTypeHTTPResponse = "http_response"
	MsgTypePing         = "ping"
	MsgTypePong         = "pong"
)

type Message struct {
	Type    string            `json:"type"`
	ID      string            `json:"id,omitempty"`
	Method  string            `json:"method,omitempty"`
	Path    string            `json:"path,omitempty"`
	Query   string            `json:"query,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
	Body    string            `json:"body,omitempty"`
	Status  int               `json:"status,omitempty"`
	Secret  string            `json:"secret,omitempty"`
	Error   string            `json:"error,omitempty"`
}
