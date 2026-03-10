发送webhook群消息
接口说明： 通过该接口，用户可以给指定群发送消息，详情参考webhook机器人使用说明。

请求方式： POST (HTTPS)，Content-Type: application/json

请求地址： https://apigw-example.domain/v1/bot/hook/messages/create?app_token=APP_ACCESS_TOKEN&hook_token=HOOK_TOKEN

query参数说明：

参数	必须	说明
app_token	否	应用调用接口的凭证，当创建webhook机器人时选择的安全设置为关联蓝信应用访问凭证时必填
hook_token	是	webhook机器人的token，创建webhook机器人时获得，必填
请求数据示例：

{
    "timestamp": "1599360473",
    "sign": "xxxxxxxxxxxxxxxxxxxxx",
    "msgType": "type",
    "msgData":{
        "type" :{
        }
    }
}
Copy to clipboardErrorCopied
请求参数字段说明：

参数	类型	必须	说明
timestamp	string	否	时间戳，精确到秒，当webhook机器人的安全设置为加签时必填
sign	string	否	签名数据，当webhook机器人的安全设置为加签时必填，具体签名算法参考: webhook机器人使用说明
msgType	string	是	发送的消息格式，支持以下几种：text、document、linkCard、appCard、oaCard, appArticles
msgData	object	是	消息概要信息，内容根据type具体定义，消息体类型
返回参数字段说明：

参数	类型	描述
msgId	string	消息标识，供其它接口查询等使用
返回数据示例：

业务正常返回：

{
  "errCode":0 ,
  "errMsg":"ok",
  "data":{
        "msgId":"678590-xxxxxxxxxxx"
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
