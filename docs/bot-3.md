查询智能机器人所属群ID列表
接口说明： 查询智能机器人所属的群列表，分页接口

请求方式： GET (HTTPS)

请求地址： https://apigw-example.domain/v2/groups/fetch?app_token=APP_TOKEN&page_offset=PAGE_OFFSET&page_size=PAGESIZE

query参数说明：

参数	必须	说明
app_token	是	应用访问TOKEN
page_offset	否	分页查询页码，不填时默认第一页
page_size	否	分页查询的单页数量，最大值100，不填时默认100
返回参数字段说明：

参数	类型	描述
totalGroupIds	int	机器人所属的群的总数量
groupIds	string array	群ID列表
返回数据示例：

业务正常返回：

{
    "errCode": 0,
    "errMsg": "ok",
    "data": {
        "totalGroupIds":2,
        "groupIds": ["524288-xxxxxxxxxxx","524288-xxxxxxxxxx"]
    }
}
Copy to clipboardErrorCopied
业务异常返回：

{
    "errCode": 错误码,
    "errMsg": 对应的统一错误码描述
}
Copy to clipboardErrorCopied
对应可能的错误码说明：

接口错误码


