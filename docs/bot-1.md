智能机器人发送私聊消息
接口说明： 通过该接口，应用可以给指定的人和分支以智能机器人的身份发送系统定义的几种消息，使用场景参考智能机器人使用说明。

请求方式： POST (HTTPS)，Content-Type: application/json

请求地址： https://apigw-example.domain/v1/bot/messages/create?app_token=APP_TOKEN

query参数说明：

参数	必须	说明
app_token	是	应用访问TOKEN
user_token	否	非必填字段, 人员TOKEN
请求数据示例：

{
    "userIdList": [ "524288-8euoAJ1avCqrpqSyyV2FVYJVB" ,"524288-8euoAJ1avCqrpqSyyV2FVYJVC" ],
    "departmentIdList":["524288-vAuMGGePYt7Oz7urrExFJxaVA"],
    "msgType": "type",
    "msgData":{
        "type" :{
        }
    },
    "//": "以下字段为选填字段，普通单入口应用不需要填",
    "entryId":"154741",
}
Copy to clipboardErrorCopied
请求参数字段说明：

参数	类型	必须	说明
userIdList	string array	否	接收者人员列表，指定消息接收者时使用，可选，与departmentIdList二者间必选一个, 最多支持1000个
departmentIdList	string array	否	接收者分支列表（分支下的所有人），可选，与userIdList二者间必选一个，如果需要全组织广播，则填根分支Id：orgId-0，例如：524288-0, 最多支持100个, 全组织广播时，只支持1个组织
msgType	string	是	发送的消息格式，支持以下几种："text"，"oacard"，"linkCard"，"appCard"
msgData	json obj	是	和 type 类型名对应的同名的格式化数据。每种格式都有对应的数据类型。消息体类型
以下字段选填	-	否	对于只有单入口的自建应用不需要填充该字段
entryId	string	否	单应用多入口情况，如果不同入口有不同消息通道，可以使用该参数指定入口对应的消息通道。其他情况组织自研应用不需要填
返回参数字段说明：

参数	类型	描述
invalidStaff	string array	请求staffIdList 列表中的人员ID 无效，无法发送
invalidDepartment	string array	请求departmentIdList列表中的分支ID 无效，无法发送
msgId	string	消息标识，供其他接口查询进度使用。目前只有组织内应用支持返回消息ID，ISV应用不返回ID
返回数据示例：

业务正常返回：

{
  "errCode":0 ,
  "errMsg":"ok",
  "data":{
        "invalidStaff":["staffid1","staffid2"],
        "invalidDepartment":["id1","id2"],
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
