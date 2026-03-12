# 新增多个relay-client支持

需求描述：

1. 能够支持多个client 链接到server，并注册client的ID，server在接收到回调消息后可以正确的分发消息给正确的client，分发的规则后面描述

server 的消息分发规则：

1. server需要新增认证信息的配置,类型openclaw lanxin plugin的配置：
      "accounts": {
        "mycw": {
          "enabled": true,
          "appId": "...",
          "appSecret": "",
          "gatewayUrl": "https://apigw.lx....",
          "callbackKey": "...",
          "callbackSignToken": "....",
          "dmPolicy": "open",
          "groupPolicy": "open",
          "allowFrom": [
            "*"
          ],
          "passportUrl": "https://passport.lx...",
          "webhookUrl": "http://localhost:18789/lanxin",
          "webhookPath": "/lanxin"
        }
      }

2. server 收到回调请求后，先解析加密的消息，根据lanxin文档的消息类型定义进行区分：

a) 若消息类型是bot_private_message，则通过消息中的 from 字段判断消息往哪个client转发

b) 若消息类型是bot_group_message，则通过groupId 字段判断消息往哪个client 转发

c）若都不属于上面的情况，或者通过字段找不到对应的client的话可以直接回复失败的消息，不转发给client了；直接回复消息也要确认是bot_private_message或者bot_group_message类型，不同的类型回复消息使用的API不一样


d) server最后给client转发的消息依然是加密的，不要转发解密过的内容；解密过的内容作为日志输出出来

client 侧的变化：

1. 根据上面server的转发逻辑，client在连接server的时候需要注册openId，这个openId可以是user的openId，也可以是group的openId

2. client带上openId链接上server后，server就有了这个client的openId信息，后续通过这个openId进行消息的转发


---

目前openclaw中针对lanxin plugin的配置为：

  "channels": {
    "lanxin": {
      "enabled": true,
      "accounts": {
        "mycw": {
          "enabled": true,
          "appId": "...",
          "appSecret": "...",
          "gatewayUrl": "https://apigw.lx...",
          "callbackKey": "...",
          "callbackSignToken": "...",
          "dmPolicy": "open",
          "groupPolicy": "open",
          "allowFrom": [
            "*"
          ],
          "passportUrl": "https://passport.lx....",
          "webhookUrl": "http://localhost:18789/lanxin",
          "webhookPath": "/lanxin"
        }
      }
    }
  },
