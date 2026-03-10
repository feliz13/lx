订阅事件查询接口
接口说明： 当应用订阅的事件通过应用回调接口推送失败后，蓝信开放平台会对失败事件进行持久化并提供本接口允许应用对失败的回调事件列表进行查询。 特别说明:一个事件只允许查询一次，通过查询接口完成查询后，事件会标记删除，再次查询时将不再返回

请求方式： POST (HTTPS)，Content-Type: application/json

请求地址： /v1/callback/events/fetch?app_token=APP_ACCESS_TOKEN&

query参数说明：

参数	必须	说明
app_token	是	应用访问TOKEN
数据请求示例：

{
    "eventType":"staff_create",
    "pageSize":100,
    "eventOrgId":524288
}
Copy to clipboardErrorCopied
请求参数字段说明：

参数	类型	必须	说明
eventType	string	否	事件类型，可选，不提供时默认全部
pageSize	int	否	分页数据返回数据长度 ，可选，不提供时默认长度为100，每个失败事件只能被查询一次，再次查询时不会返回重复数据
eventOrgId	int	否	事件组织ID，可选，不提供时默认全部
返回参数字段说明：

参数	类型	说明
total	int	当前接口返回的事件总数量
hasMore	bool	是否还有更多事件需要查询
events	json obj	事件列表
events.id	string	唯一标识一个事件的事务ID
events.eventType	string	事件类型，一个字符串，参考推送回调事件列表
events.data	json obj	事件具体结构，参考 回调事件类型格式定义
返回数据示例：

业务正常返回：

{
    "errCode": 0,
    "errMsg": "ok",
    "data": {
        "total": 2,
        "hasMore": false,
        "events": [
            {
                "id": "1655870600187758983",
                "eventType": "staff_create",
                "data": {
                    "staffId": "524288-XXXXXXX",
                    "timestamp": "123456789411"
                }
            },
            {
                "id": "1655870600187794087",
                "eventType": "staff_modify",
                "data": {
                    "staffId": "524288-YYYYYYYYY",
                    "timestamp": "123456789422"
                }
            }
        ]
    }
}
Copy to clipboardErrorCopied
业务异常返回：

{
    "errCode": 错误码 ,
    "errMsg": 对应的统一错误码描述
}
Copy to clipboardErrorCopied
接口错误码


