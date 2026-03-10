回调事件列表
订阅事件描述	订阅事件类型定义	使用说明
人员回复应用号消息	account_message	可以支持应用和人员的一对一交互
分支创建	dept_create	可用于组织架构同步
分支变更	dept_modify	可用于组织架构同步
分支删除	dept_delete	可用于组织架构同步
人员创建	staff_create	可用于组织架构同步
人员变更	staff_modify	可用于组织架构同步
人员删除	staff_delete	可用于组织架构同步
电话追确认	telephone_track	电话追逻辑，用户确认收取动作通知应用
应用安装	app_install_org	某个组织安装了应用，将组织ID通知到应用
应用卸载	app_uninstall_org	某个组织卸载了应用，将组织ID通知到应用
数据读取范围配置变更	data_scope	应用在组织内的数据读取范围配置更新
用户登出蓝信客户端	user_logout	可用于应用侧清理人员登录状态，防止重放攻击
人员给机器人的私聊消息回复	bot_private_message	只有应用开启机器人能力后该事件订阅选项才可见
人员@机器人的群聊消息回复	bot_group_message	只有应用开启机器人能力后该事件订阅选项才可见

应用号消息回复
人员回复应用号消息 (type="account_message")
数据示例：

参数	类型	描述
from	string	发送回调消息的人员ID
msgType	string	消息类型，值为 text, image, video, file, voice, position, card, sticker等
msgData	json obj	消息内容对象
文本消息
参数	类型	描述
content	string	消息内容
sendTime	string	消息发送时间戳，精确到微秒
{
    "from": "524288-xxx",
    "msgType": "text",
    "msgData": {
        "text": {
            "content": "this is a text",
            "sendTime": "1540377644020456"
        }
    }
}
Copy to clipboardErrorCopied
图片消息
参数	类型	描述
mediaIds	string array	图片文件列表
sendTime	string	消息发送时间戳，精确到微秒
{
    "from": "524288-xxx",
    "msgType": "image",
    "msgData": {
        "image": {
            "mediaIds": ["524288-xxx1", "524288-xxx2"],
            "sendTime": "1540377644020456"
        }
    }
}
Copy to clipboardErrorCopied
视频消息
参数	类型	描述
mediaIds	string array	视频文件列表
sendTime	string	消息发送时间戳，精确到微秒
{
    "from": "524288-xxx",
    "msgType": "video",
    "msgData": {
        "video": {
            "mediaIds": ["524288-xxx1", "524288-xxx2"],
            "sendTime": "1540377644020456"
        }
    }
}
Copy to clipboardErrorCopied
文档消息
参数	类型	描述
mediaIds	string array	文档文件列表
sendTime	string	消息发送时间戳，精确到微秒
{
    "from": "524288-xxx",
    "msgType": "file",
    "msgData": {
        "file": {
            "mediaIds": ["524288-xxx1", "524288-xxx2"],
            "sendTime": "1540377644020456"
        }
    }
}
Copy to clipboardErrorCopied
语音消息
参数	类型	描述
mediaIds	string array	语音文件列表
sendTime	string	消息发送时间戳，精确到微秒
{
    "from": "524288-xxx",
    "msgType": "voice",
    "msgData": {
        "voice": {
            "mediaIds": ["524288-xxx1", "524288-xxx2"],
            "sendTime": "1540377644020456"
        }
    }
}
Copy to clipboardErrorCopied

位置消息
参数	类型	描述
type	int	坐标类型：0-火星坐标，1-GPS的经纬坐标
latitude	double	经度
longitude	double	纬度
name	string	位置名
address	string	详细地址信息
link	string	地理位置卡片的链接
mediaId	string	位置对应图片的ID
sendTime	string	消息发送时间戳，精确到微秒
{
    "from": "524288-xxx",
    "msgType": "position",
    "msgData": {
        "position": {
            "type": 1,
            "latitude": 1233.220,
            "longitude": 2333.212,
            "name": "北京",
            "address": "北京市朝阳区",
            "link": "www.test.com",
            "mediaId": "524288-xxx",
            "sendTime": "1540377644020456"
        }
    }
}
Copy to clipboardErrorCopied
名片消息
参数	类型	描述
staffId	string	人员ID
sendTime	string	消息发送时间戳，精确到微秒
{
    "from": "524288-xxx",
    "msgType": "card",
    "msgData": {
        "card": {
            "staffId": "staff_id",
            "sendTime": "1540377644020456"
        }
    }
}
Copy to clipboardErrorCopied
表情消息
参数	类型	描述
stickerId	string	表情ID
sendTime	string	消息发送时间戳，精确到微秒
{
    "from": "524288-xxx",
    "msgType": "sticker",
    "msgData": {
        "sticker": {
            "stickerId": "sticker_id",
            "sendTime": "1540377644020456"
        }
    }
}
Copy to clipboardErrorCopied
分支信息变更
分支创建 (type="dept_create")
数据示例：

参数	类型	描述
deptId	string	创建分支ID
timestamp	string	创建时间戳，精确到微秒
{
    "deptId": "524288-xxxxx",
    "timestamp": "123456789411"
}
Copy to clipboardErrorCopied
分支变更 (type="dept_modify")
数据示例：

参数	类型	描述
deptId	string	变更分支ID
timestamp	string	变更时间戳，精确到微秒
{
    "deptId": "524288-xxxxx",
    "timestamp": "123456789411"
}
Copy to clipboardErrorCopied
分支删除 (type="dept_delete")
数据示例：

参数	类型	描述
deptId	string	删除分支ID
timestamp	string	删除时间戳，精确到微秒
{
    "deptId": "524288-xxxxx",
    "timestamp": "123456789411"
}
Copy to clipboardErrorCopied
人员信息变更事件
人员创建 (type="staff_create")
数据示例：

参数	类型	描述
staffId	string	创建人员ID
timestamp	string	创建时间戳，精确到微秒
{
    "staffId": "524288-xxxxx",
    "timestamp": "123456789411"
}
Copy to clipboardErrorCopied
人员信息变更 (type="staff_modify")
数据示例：

参数	类型	描述
staffId	string	发生信息变更的人员ID
timestamp	string	更新时间戳，精确到微秒
{
    "staffId": "524288-xxxxx",
    "timestamp": "123456789411"
}
Copy to clipboardErrorCopied
人员删除 (type="staff_delete")
数据示例：

参数	类型	描述
staffId	string	删除人员ID
timestamp	string	删除时间戳，精确到微秒
{
    "staffId": "524288-xxxxx",
    "timestamp": "123456789411"
}
Copy to clipboardErrorCopied
电话追确认回调
电话追确认回调 (type="telephone_track")
数据示例：

参数	类型	描述
transactionId	string	事务ID， 唯一标识一次请求
attach	string	透传数据（对应微应用的appId）
caller	json obj	发起呼叫的人员信息(结构见下表)
callee	json obj	被呼叫的人员信息(结构见下表)
confirmType	int	0- 取消， 1-确认
timestamp	string	处理时间戳，精确到微秒
staffId	string	人员Id
mobilePhone	json obj	手机号信息
mobilePhone.countryCode	int	手机号
mobilePhone. number	string	手机号
{
    "transactionId": "524288-xxxxx",
    "attach":"xxxxxx",
    "caller": {
        "staffId": "524288-xxxxxxx",
        "mobilePhone": {
            "countryCode": 86,
            "number": "12345678902"
        }
    },
    "callee": {
        "staffId": "524288-xxxxxxx",
        "mobilePhone": {
            "countryCode": 86,
            "number": "12345678902"
        }
    },
    "confirmType":1,
    "timestamp": "1234567890"
}
Copy to clipboardErrorCopied
应用安装,卸载与配置更新
应用安装 (type="app_install_org")
数据示例：

参数	类型	描述
orgId	string	组织ID
orgName	string	组织名称
timestamp	string	事件时间戳，精确到微秒
{
    "orgId": "524288",
    "orgName": "组织名称",
    "timestamp": "123456789411"
}
Copy to clipboardErrorCopied
应用卸载 (type="app_uninstall_org")
数据示例：

参数	类型	描述
orgId	string	组织ID
orgName	string	组织名称
timestamp	string	事件时间戳，精确到微秒
{
    "orgId": "524288",
    "orgName": "组织名称",
    "timestamp": "123456789411"
}
Copy to clipboardErrorCopied
数据读取范围配置变更 (type="data_scope")
数据示例：

参数	类型	描述
deptIds	string array	分支ID列表
timestamp	string	事件时间戳，精确到微秒
{
    "deptIds": ["234583-XXXXXX","234583-YYYYYY","234583-ZZZZZZZZ"],
    "timestamp": "123456789688"
}
Copy to clipboardErrorCopied
用户登录状态通知
用户登出蓝信客户端 (type="user_logout")
数据示例：

参数	类型	描述
staffId	string	人员ID
deviceId	string	设备ID
timestamp	string	事件时间戳，精确到微秒
{
    "staffId":"234583-xxxxx",
    "deviceId":"设备id",
    "timestamp":"12345678899"
}
Copy to clipboardErrorCopied
智能机器人回复事件
自然人用户给智能机器人的私聊消息回复(type="bot_private_message")
数据示例：

参数	类型	描述
from	string	发送回复消息给智能机器人的人员openId
entryId	string	应用入口ID，大部分应用默认只有一个入口，可以忽略该字段
msgType	string	消息类型，值为 text, image, video, file, voice, position, card, sticker等
msgData	object	消息内容对象，具体消息格式参照上面的公号消息回复格式
{
    "from": "524288-xxx",
    "entryId":"xxx-xxx-xxx",
    "msgType": "text",
    "msgData": {
        "text": {
            "content": "this is a text",
            "sendTime": "1540377644020456"
        }
    }
}
Copy to clipboardErrorCopied
自然人用户@智能机器人的群聊消息回复(type="bot_group_message")
数据示例：

参数	类型	描述
groupId	string	群openId
from	string	@智能机器人并发送回复消息的人员openId
entryId	string	应用入口ID，大部分应用默认只有一个入口，可以忽略该字段
msgType	string	消息类型，值为 text, image, video, file, voice, position, card, sticker等
msgData	json obj	消息内容对象，具体消息格式参照上面的公号消息回复格式
{
    "groupId": "524288-xxx",
    "from": "524288-yyy",
    "entryId":"xxx-xxx-xxx",
    "msgType": "text",
    "msgData": {
        "text": {
            "content": "@智能机器人",
            "sendTime": "1540377644020456"
        }
    }
}
Copy to clipboardErrorCopied

