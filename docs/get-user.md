
获取人员基本信息
接口说明： 可以获人员的基本信息。

请求方式： GET (HTTPS)

请求地址： https://apigw-example.domain/v1/staffs/:staffid/fetch?app_token=APP_TOKEN

query参数说明：

参数	必须	说明
app_token	是	应用访问 TOKEN
user_token	否	非必填字段，人员TOKEN
param 参数说明：

参数	必须	说明
staffid	是	人员 ID
返回参数字段说明：

参数	类型	描述
orgId	string	人员组织ID
name	string	人员姓名
orgName	string	人员组织名
gender	int	性别 （可选值：0-保密；1-男；2-女；）
signature	string	签名
avatarUrl	string	人员头像下载地址,一小时有效
avatarId	string	人员头像资源ID
status	int	成员状态：0-未激活；1-已激活；2-已冻结；3-已删除；5-待删除；
departments	json obj	所在分支信息
departments.id	string	分支ID
departments.name	string	分支名称
departments.orderNumber	int	分支在父分支的排序信息
返回数据示例：

业务正常返回：

{
    "errCode": 0,
    "errMsg": "ok",
    "data": {
        "orgId": "788",
        "orgName":"组织名称",
        "name": "张三",
        "gender": 1,
        "signature": "生活是美好的",
        "avatarUrl": "http://路径",
        "avatarId":"788-3456",
        "status":  1,
        "departments": [                     
           {
             "id": "788-3145728",
             "name": "核心服务组"
             "orderNumber": 10
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
对应可能的错误码说明：

接口错误码