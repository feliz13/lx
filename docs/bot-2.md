智能机器人发送群消息
接口说明： 通过该接口，以智能机器人的身份给智能机器人所在的群发送系统定义的几种消息，使用场景参考智能机器人使用说明。当user_token不为空时，该接口同时支持以人员（自然人，需要是群成员）身份向群内发送消息。

请求方式： POST (HTTPS)，Content-Type: application/json

请求地址： https://apigw-example.domain/v1/messages/group/create?app_token=APP_TOKEN&user_token=USER_TOKEN

query参数说明：

参数	必须	说明
app_token	是	应用访问TOKEN
user_token	否	如果user_token不为空，则以人的身份发送群消息。支持智能机器人发送群消息，需要开启智能机器人能力，此时user_token不填
请求数据示例：

{
    "groupId":"524288-AB4DDDABBKHIM",
    "outlines":"[通知]xxx: xxxxxx",
    "msgType": "type",
    "msgData":{
        "type" :{
        }
    }
}
Copy to clipboardErrorCopied
请求参数字段说明：

参数	类型	必须	说明
groupId	string	是	群openId，应用通过两种方式获取群Id，1，智能机器人群消息回调事件信息中包含群Id。2，可以通过开放平台接口查询智能机器人所在的群Id列表 获取机器人所在群列表
outlines	string	否	目前只用于群通知的摘要信息
entryId	string	否	单应用多入口情况，如果不同入口有不同消息通道，可以使用该参数指定入口对应的消息通道
msgType	string	是	发送的消息格式，支持以下几种：text ,oacard
msgData	json obj	是	和 type 类型名对应的同名的格式化数据。每种格式都有对应的数据类型。消息体类型
返回参数字段说明：

参数	类型	描述
msgId	string	消息标识。供其他接口查询进度使用
返回数据示例：

业务正常返回：

{
  "errCode":0 ,
  "errMsg":"ok",
   "data":{
        "msgId":"678590"
  } 
}
Copy to clipboardErrorCopied
业务异常返回：

{
    "errCode": 错误码 ,
    "errMsg": 对应的统一错误码描述
}
Copy to clipboardErrorCopied
对应可能的错误码说明：

接口错误码

消息体类型：参见消息体类型


