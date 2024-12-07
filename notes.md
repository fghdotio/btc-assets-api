
By default, register creates a new scope, this means that if you make some changes to the Fastify instance (via decorate), this change will not be reflected by the current context ancestors, but only by its descendants.  
> https://fastify.dev/docs/latest/Reference/Plugins/#plugins




- [ ] debug：监听文件改动，自动重启

```bash
curl -X 'GET' \
  'http://92.118.56.39:3000/rgbpp/v1/transaction/de355428762b7ed3b613eb0344bbbbcfd3e51470150e052c39820729786e65e7' \
  -H 'accept: application/json' \
  -H "Origin: https://rgbpp.testnet.fgh.rs" \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmZ2hwcCIsImF1ZCI6InJnYnBwLnRlc3RuZXQuZmdoLnJzIiwianRpIjoiY2IwNmVkYmItZGE5Yy00ODc3LTg4N2MtY2FjOWFlNGJhOGZiIiwiaWF0IjoxNzMzMjUzNTU1fQ.h4MKFDKkfgwCvCptBzoge21AGbSNJ-5mEOanHm9VB8Q' \
  -w "\n%{http_code}\n"

curl -X 'GET' \
  'http://92.118.56.39:3000/bitcoin/v1/info' \
  -H 'accept: application/json' \
  -H "Origin: https://rgbpp.testnet.fgh.rs" \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmZ2hwcCIsImF1ZCI6InJnYnBwLnRlc3RuZXQuZmdoLnJzIiwianRpIjoiY2IwNmVkYmItZGE5Yy00ODc3LTg4N2MtY2FjOWFlNGJhOGZiIiwiaWF0IjoxNzMzMjUzNTU1fQ.h4MKFDKkfgwCvCptBzoge21AGbSNJ-5mEOanHm9VB8Q' \
  -w "\n%{http_code}\n"
```