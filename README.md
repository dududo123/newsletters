R&D본부 소식지 — 테스트 사이트 (GitHub + Netlify)
=================================================
이 폴더 전체가 하나의 GitHub 저장소가 됩니다. (운영 사이트와 데이터가 완전히 분리됨)

[폴더 구조]
  netlify.toml                    Netlify 설정 (화면 폴더 = public, 서버 폴더 = netlify/functions)
  package.json                    서버가 쓰는 저장소 라이브러리(@netlify/blobs) 목록
  public/index.html               화면
  public/css/style.css, meal.css
  public/js/app.js, news-enhance.js, community.js, meal.js, admin.js
  netlify/functions/api.mjs       서버: 소식지·샐러드·조회수·식단사진·미태그·외부인신청
  netlify/functions/community.mjs 서버: 공지·설문·좋아요

[1] GitHub 저장소 만들기
  1. github.com 로그인 → 오른쪽 위 [+] → New repository
  2. 이름: rnd-newsletter-test  / Private 선택 / 나머지 그대로 → Create repository
  3. 만들어진 화면에서 "uploading an existing file" 클릭
  4. 압축을 푼 폴더 안의 내용물(netlify.toml, package.json, public 폴더, netlify 폴더)을
     전부 선택해서 브라우저 창으로 끌어다 놓기  ※ zip 파일 자체를 올리면 안 됩니다
     ※ .gitignore 는 숨김파일이라 안 보여도 괜찮습니다
  5. 아래 [Commit changes] 클릭
  6. 저장소 첫 화면에서 public, netlify 폴더가 보이는지 확인

[2] Netlify 와 연결
  1. app.netlify.com 로그인 → Add new site(Add new project) → Import an existing project
  2. GitHub 선택 → 권한 허용 → rnd-newsletter-test 선택
     (저장소가 안 보이면 "Configure the Netlify app on GitHub" 에서 이 저장소 접근 허용)
  3. 설정 화면: Branch = main, Build command = 비움, Publish directory = public
     (netlify.toml 이 있어서 자동으로 채워집니다) → Deploy
  4. 1~2분 뒤 Deploys 가 Published 가 되면 https://○○○.netlify.app 주소로 접속
  5. Site configuration > Site details > Change site name 에서 주소 이름 변경 가능
     (예: rnd-newsletter-test.netlify.app)

[3] 외부인 식사신청 메일 알림 켜기 (Netlify Forms)
  1. 사이트 > Forms > [Enable form detection] 클릭
  2. Deploys > Trigger deploy > Deploy site  (폼을 인식시키려면 한 번 더 배포 필요)
  3. Forms 목록에 guest-meal-notify 가 생겼는지 확인
  4. Site configuration > Notifications > Emails and webhooks
     > Form submission notifications > Add notification > Email notification
     · Email to notify: 20220412@lottechem.com   · Form: guest-meal-notify → Save
  5. 사이트에서 외부인 식사 신청 1건 → 메일 확인 (스팸함도 확인)
     · 발신자: formresponses@netlify.com
     · 메일 안의 adminLink 주소를 누르면 관리자 로그인 후 '외부인 식사신청' 탭이 열림
  (선택) 메일 디자인/제목을 직접 정하고 싶으면 Resend 사용:
     Site configuration > Environment variables > RESEND_API_KEY 추가 후 다시 배포

[4] 이후 수정 방법
  GitHub 에서 파일 수정 → Commit → Netlify 가 자동으로 다시 배포 (1~2분)
  화면이 안 바뀌면 Ctrl+F5, 그래도 안 되면 index.html 의 ?v= 숫자를 올려서 커밋

[주소 정리]
  일반 화면          https://사이트주소/
  관리자             https://사이트주소/?admin            (처음 인증코드 1234)
  외부인 신청 관리   https://사이트주소/?admin=guest
  미태그 등록 팝업   https://사이트주소/?untag=1           (QR코드용)
