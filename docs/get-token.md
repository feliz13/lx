
获取应用访问TOKEN
接口说明： 使用AppId，AppSecret，创建应用访问APP_TOKEN

请求方式： GET (HTTPS)

请求地址： https://apigw-example.domain/v1/apptoken/create?grant_type=client_credential&appid=APPID&secret=SECRET

query参数说明：

参数	必须	说明
grant_type	是	可赋值为："client_credential"
appid	是	应用ID, 创建应用时取得
secret	是	应用对应的AppSecret， 创建应用时取得
返回参数字段说明：

参数	类型	描述
appToken	string	应用访问APP_TOKEN
expiresIn	int	TOKEN 有效期（7200秒），建议应用根据过期时间缓存appToken, 单次获取，多次使用
返回数据示例：

业务正常返回：

{
    "errCode": 0,
    "errMsg": "ok",
    "data": {
         "appToken": "APP_TOKEN",
         "expiresIn": 7200
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

