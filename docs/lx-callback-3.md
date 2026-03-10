订阅事件回调接口
接口说明： 该接口由第三方应用实现，接口地址需要注册到蓝信开发者中心。应用订阅的事件触发后，蓝信开放平台发起POST请求将事件以JSON数据方式推送到该接口。

开放平台调用应用回调接口时，有3秒左右的超时时间设置，如接口调用在设置的时间内没有返回，或接口返回其他错误，蓝信开放平台会认为接口调用失败并尝试重试，重试次数最多3次，分别在第一次回调失败后的5分钟，1小时，6小时。因为事件有重复回调，应用侧需要根据事件ID进行去重处理。最后一次充实失败后，失败事件会进行持久化，应用可以通过订阅事件查询接口接口查询应用相关的失败事件列表。

如果应用侧回调接口的业务逻辑处理所需时间较长，建议应用侧回调接口实现采用异步方式，尽快返回开放平台的接口调用，然后通过异步方式处理由回调事件触发的应用侧业务。

请求方式： POST (HTTPS)，Content-Type: application/json

请求地址： http(s)://callback?timestamp=TIMESTAMP&nonce=NONCE&signature=SIGNATURE

query参数说明（仅当第三方应用回调地址是 http 的时候)：

参数	必须	说明
timestamp	是	发送回调消息的时间
nonce	是	一个随机值
signature	是	计算后的签名,签名计算方式参考消息加解密说明
当第三方回调地址是 http/https 的时候 ，请求数据会按照 消息加解密说明 加密成一个字符串）：

解密前：

{
 "dataEncrypt": "XXXXXXXX"
}
Copy to clipboardErrorCopied
解密后：

{
    "dataEncrypt": {
        "random": "3vVNtlYYLTuAMiWQclQac0hPWqwm6HpxVJBay7QSU0a",
        "length": 179,
        "appId": "2990080-14155776",
        "orgId": "2990080",
        "events": [{
            "id": "816b1029261c76a058c75c2f7f9083b8",
            "eventType": "dept_create",
            "data": {
                "deptId": "524288-8euatzH7z7XFPgn0xbtP6B92pcagy",
                "timestamp": "1680075586163886"
            }
        }]
    }
}
Copy to clipboardErrorCopied
请求参数字段说明：

参数	类型	必须	说明
random	string	是	随机字符串，唯一标识一次请求
length	int	是	表示events 的 JSON 字符串长度
appId	string	是	应用ID
orgId	string	是	组织ID
events	obj array	是	事件列表
events.id	string	是	回调消息去重的id。第三方可以用这个ID进行消息去重。
events.eventType	string	是	事件类型，具体定义参见 回调事件类型格式定义
events.data	string	是	事件具体结构，具体定义参见 回调事件类型格式定义）
返回参数字段说明：

第三方回调服务接口收到请求后需要发送应答响应包。不需要做加密处理。

参数	描述
errCode	0: 第三方正确进行接收并且解析正常（包括解密）
-1:解密失败
-2:计算签名失败
-3:数据反序列化失败
-4:其他类型错误
errMsg	
返回数据示例：

业务正常返回：

{
  "errCode":0 ,
  "errMsg":"ok"
}
Copy to clipboardErrorCopied

