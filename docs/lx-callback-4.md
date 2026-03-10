消息加解密说明
对第三方应用回调地址，目前不强求支持 HTTPS。

因此为保证回调过程中的源端可信以及传输数据可靠性，在 回调 URL 参数中引入签名计算过程，在回调请求报文体中的内容引入加密过程。

应用接收到蓝信开平的回调请求后，需要：

对回调数据进行签名验证，可以防止对回调接口的非法请求，DDOS攻击等行为。应用的签名验证是建议操作，不是强制要求。
对回调的加密数据进行解密。应用的回调数据解密是必须的，否则应用拿不到明文的回调数据。
应用对回调请求数据进行解密时，需要使用回调密钥（aesKey），对签名进行验证时，需要使用回调签名令牌（signToken）。回调密钥和回调签名令牌是开发者在蓝信开发者中心创建应用并配置回调地址后获得。这两个参数需要作为配置参数配置到应用服务端，并注意保密，避免泄漏。 回调密钥与签名令牌

生成签名的过程需要传递四个参数，包含了 签名token、时间戳、随机字符串，加密后的消息体

dev_data_signature=sha1(sort(token、timestamp、nonce、dataEncrypt))。

参数	必须	说明
token	是	在蓝信应用开发中心配置回调地址的时候指定的签名参数
timestamp	是	时间戳
nonce	是	随机值
dataEncrypt	是	见下文的消息加解密过程
生成签名包含以下两个步骤：

1、用sort函数将四个参数（均是字符串）按照参数值字母字典顺序进行从小到大排序，排序好后组成一个完整的字符串。

2、对排序好后的字符串按照SHA1 进行编码，编码的方式是把每字节散列值打印为%02x（即16进制，C printf语法）格式，全部小写 。生成的签名会在回调URL中传递到第三方，参考 回调接口定义 回调接口定义

dataEncrypt = Base64_Encode( AES_Encrypt[random(16B) + eventsLen(4B) + orgId + appId + events ] )

AES加密的buf是一个JSON体序列化后的数据，详细JSON结构参考 回调接口定义

对密文BASE64解码

aes_msg=Base64_Decode(dataEncrypt)

使用AESKey做AES解密

rand_msg=AES_Decrypt(aes_msg)






注意事项: 1 , 应用若使用 java 的加解密库实现加解密时，此处采用的 Aes Key 的 256 Bit 方式会抛出异常:Illegal key size ( 受美国对软件出口限制的影响 )。
解决方案: 通过下载以下的资源对应替换运行环境的 jdk 与 jre 下的两个jar包: local_policy.jar 和 US_export_policy.jar 。

JDK6对应资源、 JDK7对应资源、 JDK8对应资源

Go 语言签名算法示例代码如下：

package testing

import (
        "crypto/sha1"
        "fmt"
        "sort"
        "testing"
)

func TestGenCallbackSign(t *testing.T) {
        token := "31a4a1aa-cffc-4aca-9ef6-0497edf7fbed"
        timestamp := "1646790230854428120"
        nonce := "Rzem0rlz19e6GZuZuFKyDzaxiS4baaqn8uvxVnntXKS"
        dataEncrypt:= "abcdefg"
        signature := GenerateSignature(token, timestamp, nonce, dataEncrypt)
        fmt.Println(signature)
        return
}       

// 数据签名计算
func GenerateSignature(token, timestamp, nonce, dataEncrypt string) (sign string) {
        // 先将参数值进行排序 
        // 排序完毕进行SH1哈希
        params := make([]string, 0)
        params = append(params, token)
        params = append(params, dataEncrypt)
        params = append(params, timestamp)
        params = append(params, nonce)
        sort.Strings(params)
        return Sha1Sign(params[0] + params[1] + params[2] + params[3])
}       

//sha1哈希
func Sha1Sign(s string) string {
        h := sha1.New() 
        h.Write([]byte(s))
        //最终的哈希结果作为字节切片获取
        bs := h.Sum(nil)
        // SHA1值通常以十六进制格式打印,使用`％x`格式将哈希结果转换为十六进制字符串。
        return fmt.Sprintf("%x", bs)
}
Copy to clipboardErrorCopied
Go 语言解密算法示例代码如下：

package testing

import (
        "crypto/aes"
        "crypto/cipher"
        "encoding/base64"
        "fmt"
        "testing"
)

func TestDecryptMsg(t *testing.T) {
        //密文
        dataEncrypt := "Iyh39ROwCyFhr5YPzQQF3cNsBbYpEZ9d+MbVzqUsyItgQMuhMbLZovpZb2kS0XAn7k8H/yUkxO5DQTUmGf4Xrhg5E/WukVddrhxV2V5VTr48+9SDrHpkWYK2Vr6lh4hb31wGfTLI+JV3L65Ep9+Mx124ZbK2K9Lo2jn6BUyU++6VhE0MKyeewrw00QM/b3KZzjXsMsf6tU/vtOazefC0OaAj9F0cuU+m8E3qArjqlDbdSup292e3h1nZpf9A6xGfhh/6KEJOn04VBiP4xN+uqCHQMjYM7Qj/0GRssksV7aeMEfBgMjVwtv0ymMpKhabs6S5j8FnvdPN3KzeS9CjebnvBrzIWnbhituz6951/XDW8OTxkRoa3sCW32ywMzyF9oKBvLR8lAtb9+Is9c2HHkXnEi0FRs/ZJkxTm+NvgxJdZT3epV3QnlHzkbR7QZf9XLd62QaRUNnkcgdhZs3nwihWsJ3oWXyFQ2/8d+I/TWX0="
        //AES密钥
        aesKey := "RDNBMkZCNkFDMThERjFDNkNFMjVFRDBEMjc4NkRERjM"

        msg, _ := DecryptMsg(dataEncrypt, aesKey)
        //解密后的明文结果
        fmt.Println(msg) 
}

//解密密文
func DecryptMsg(dataEncrypt, aesKey string) (string, int) {
        //base64解码
        decode, err := base64.StdEncoding.DecodeString(dataEncrypt)
        if err != nil {
                return "", -1 //BASE64解码失败
        }
        //解码后长度小于AES的BlockSize，默认16
        if len(decode) < aes.BlockSize {
                return "", -3
        }
        byteKey, err := base64.StdEncoding.DecodeString(aesKey + "=")
        if err != nil {
                return "", -1
        }
        block, err := aes.NewCipher(byteKey)
        if err != nil {
                return "", -2
        }
        blockSize := block.BlockSize()
        blockMode := cipher.NewCBCDecrypter(block, byteKey[:blockSize])
        plantText := make([]byte, len(decode))
        blockMode.CryptBlocks(plantText, decode)
        plantText = PKCS7UnPadding(plantText)
        return string(plantText), 0
}

func PKCS7UnPadding(plantText []byte) []byte {
        length := len(plantText)
        unpadding := int(plantText[length-1])
        return plantText[:(length - unpadding)]
}
Copy to clipboardErrorCopied
Java 语言签名算法示例代码如下：

import java.security.NoSuchAlgorithmException;
import java.security.MessageDigest;
import java.util.Arrays;

class Example {
    public static void main(String[] args) throws NoSuchAlgorithmException {
        String token = "31a4a1aa-cffc-4aca-9ef6-0497edf7fbed";
        String nonce = "Rzem0rlz19e6GZuZuFKyDzaxiS4baaqn8uvxVnntXKS";
        String  timestamp = "1646790230854428120";
        String dataEncrypt= "abcdefg";
        final String[] arrayStrs = { token, timestamp, nonce, dataEncrypt};
        Arrays.sort(arrayStrs);
        String sTemp = "";
        for (final String s : arrayStrs) {
            sTemp += s;
        }
        final MessageDigest md = MessageDigest.getInstance("SHA-1");
        md.update(sTemp.getBytes());
        final byte[] digest = md.digest();
        String signature = "";
        for (final byte b : digest) {
            signature += String.format("%02x", b);
        }
        System.out.println(signature);
        return;
    }
}
Copy to clipboardErrorCopied
Java 语言解密算法示例代码如下：

import javax.crypto.spec.IvParameterSpec;
import java.util.Arrays;
import javax.crypto.spec.SecretKeySpec;
import javax.crypto.Cipher;
import org.apache.commons.codec.binary.Base64;

class Example {
    private static Base64 base64 = new Base64();
    public static void main(String[] args) throws NoSuchAlgorithmException {
        //原始密文
        String dataEncrypt= "Iyh39ROwCyFhr5YPzQQF3cNsBbYpEZ9d+MbVzqUsyItgQMuhMbLZovpZb2kS0XAn7k8H/yUkxO5DQTUmGf4Xrhg5E/WukVddrhxV2V5VTr48+9SDrHpkWYK2Vr6lh4hb31wGfTLI+JV3L65Ep9+Mx124ZbK2K9Lo2jn6BUyU++6VhE0MKyeewrw00QM/b3KZzjXsMsf6tU/vtOazefC0OaAj9F0cuU+m8E3qArjqlDbdSup292e3h1nZpf9A6xGfhh/6KEJOn04VBiP4xN+uqCHQMjYM7Qj/0GRssksV7aeMEfBgMjVwtv0ymMpKhabs6S5j8FnvdPN3KzeS9CjebnvBrzIWnbhituz6951/XDW8OTxkRoa3sCW32ywMzyF9oKBvLR8lAtb9+Is9c2HHkXnEi0FRs/ZJkxTm+NvgxJdZT3epV3QnlHzkbR7QZf9XLd62QaRUNnkcgdhZs3nwihWsJ3oWXyFQ2/8d+I/TWX0=";
        //AES密钥
        String aesKey = "RDNBMkZCNkFDMThERjFDNkNFMjVFRDBEMjc4NkRERjM";

        final byte[] decodes = base64.decode(dataEncrypt);
        final byte[] byteKey = base64.decode(aesKey + "=");
        final Cipher cipher;
        try {
            cipher = Cipher.getInstance("AES/CBC/NoPadding");
            cipher.init(2, new SecretKeySpec(byteKey, "AES"), new IvParameterSpec(Arrays.copyOfRange(byteKey, 0, 16)));
            final byte[] encrypted = Base64.decodeBase64(dataEncrypt);
            final byte[] encrpBytes = cipher.doFinal(encrypted);
            final byte[] replyMsgBytes = GetPKCS7UnPadding(encrpBytes);
            String msg = new String(replyMsgBytes, "UTF-8");
            //解密后的明文结果
            System.out.println(msg);
        } catch (GeneralSecurityException | UnsupportedEncodingException e){
            e.printStackTrace();
            return;
        }
        return;
    }
    public static byte[] GetPKCS7UnPadding(final byte[] encrpBytes) {
        final int elength = encrpBytes.length;
        int cnt = encrpBytes[elength - 1];
        if (cnt < 1 || cnt > 32) {
            cnt = 0;
        }
        return Arrays.copyOfRange(encrpBytes, 0, elength - cnt);
    }
}
Copy to clipboardErrorCopied
Python 语言签名算法示例代码如下：

#!/usr/local/bin/python3
import hashlib


def generate_signature(token, timestamp, nonce, encrypt_data):
    params = [token, encrypt_data, timestamp, nonce]
    params.sort()
    h = hashlib.sha1(''.join(params).encode("utf-8"))
    return h.hexdigest()


if __name__ == '__main__':
    token = "31a4a1aa-cffc-4aca-9ef6-0497edf7fbed"
    timestamp = "1646790230854428120"
    nonce = "Rzem0rlz19e6GZuZuFKyDzaxiS4baaqn8uvxVnntXKS"
    encrypt_data = "abcdefg"

    sign = generate_signature(token, timestamp, nonce, encrypt_data)
    print(sign)
Copy to clipboardErrorCopied
Python 语言解密算法示例代码如下：

#!/usr/local/bin/python3

# $ pip install pycryptodome

import base64
from Crypto.Cipher import AES


def decrypt(key, content):
    key = base64.b64decode(key + "=").decode("utf-8")

    encrypt_bytes = base64.b64decode(content)

    key_bytes = bytes(key, encoding='utf-8')

    cipher = AES.new(key_bytes, AES.MODE_CBC, bytes(key[:AES.block_size], encoding='utf-8'))

    decrypt_bytes = cipher.decrypt(encrypt_bytes)

    result = str(decrypt_bytes, encoding='utf-8')

    result = pkcs7unpadding(result)
    return result


def pkcs7unpadding(text):
    length = len(text)
    unpadding = ord(text[length - 1])
    return text[0:length - unpadding]


if __name__ == '__main__':
    aes_key = "RDNBMkZCNkFDMThERjFDNkNFMjVFRDBEMjc4NkRERjM"

    encrypt_data = '5A/cI322pghOwnRCBoMZmOPjhzpZIdNmtW1Q05oG4z8L8lwIca2kIjrrwfGxlhJOk2LmLsdSLGRNQekNp8icYvd0W7vu7/hqL18wpYRgng0hvjUyUOBtpytU1qWwqyOaAIt9NwzJGq3emSlWhFMle/GnJqNer3vwyZ/IftfJ5mdG3qX02OLXV6cLEz3FhuhJLfLRUjmn2ZhCLv6+v3S+agdsYIU700sivpYW2bleG7AfaMz6uCyo0/EtXOjo+Ba3NnNuPd/mnwUo5raTOynj6SaLnpLJLCqZ56wtQeFuxYIetooOcv122DGM8t6Dg9oy8+1H7ZKGAzHjw9sBjg+2v5QEPodpgNl7bhBqbtNCxRUokkcLwbM7jawm9pVBkErj9Hh59zXtFCkka6ExCPo9/p/AA8+Tda/4r1KNnGDjw/pGsCt5m5AC1R+ub2Z35FyENXHP7tb9z5qn5eqthCUVg512PGCrE1GAEK8Gp7S4aTCrU7fQPh9QTXTxnpLiDFIrQUO6pTXaEmWhGz+KISOC5A=='

    decrypt_data = decrypt(aes_key, encrypt_data)

    print(decrypt_data)
Copy to clipboardErrorCopied

