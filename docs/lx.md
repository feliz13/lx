https://openapi.lanxin.cn/#/server-api/callback/pushcallback/callback_api

目前lanxin是通过一个callback回调来给应用推送消息的；

这里的应该指的就是我本地的openclaw，但是问题是openclaw是部署在本地电脑上的，并没有一个可以对外暴露可以直接被访问的IP地址。

所以这里需要引入一个中间人的组件，作用类似于：

1) local openclaw <--> [远端服务] <--> lanxin server

或者本地也起一个服务，架构类似：

2) local openclaw <--> [本地服务] <--> [远端服务] <--> lanxin serer

第(2)种架构的好处应该是可以兼容现有的openclaw的lanxin plugin

可以判断一下哪种架构更合理然后再修改.

2种方案的逻辑如下：

在（1）中 openclaw 启动后需要链接[远端服务]，保持一个长连接；lanxin-server在回调的时候可以请求 [远端服务] 的callback API，然后[远端服务]异步的在把消息推送给 local openclaw

在（2）中 [本地服务]和[远端服务]要先启动，启动后[本地服务]会和[远端服务]保持一个长连接; openclaw中lanxin plugin的逻辑基本不变，当lanxin-server有消息要推送的时候，调用的是[远端服务]的callback API,然后[远端服务]再推送给[本地服务]，[本地服务]最后再调用openclaw/lanxin
