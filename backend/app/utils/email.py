import smtplib
from email.message import EmailMessage

from app.core.config import settings
from app.core.logger import logger


def send_password_reset_email(to_email: str, token: str) -> bool:
    """DWP TM ile aynı mantık: TLS SMTP + reset bağlantısı."""
    base = settings.frontend_url.rstrip("/")
    reset_url = f"{base}/reset-password?token={token}"

    from_addr = (settings.mail_from_address or settings.smtp_username).strip()
    if not from_addr:
        logger.warning("SMTP gönderilemedi: smtp_username / mail_from_address boş.")
        return False

    msg = EmailMessage()
    msg["Subject"] = f"{settings.app_name} — Password reset"
    msg["From"] = (
        f"{settings.smtp_from_name} <{from_addr}>"
        if settings.smtp_from_name
        else from_addr
    )
    msg["To"] = to_email

    msg.set_content(
        f"Hello,\n\n"
        f"You requested a password reset. Open this link:\n{reset_url}\n\n"
        f"If you did not request this, you can ignore this email.\n"
    )

    msg.add_alternative(
        f"""\
<html>
  <body>
    <p>Hello,</p>
    <p>You requested a password reset.</p>
    <p>
      <a href="{reset_url}" style="background:#0d9488;color:white;padding:10px 20px;
         text-decoration:none;border-radius:8px;display:inline-block;">
        Reset password
      </a>
    </p>
    <p>If you did not request this, you can ignore this email.</p>
  </body>
</html>
""",
        subtype="html",
    )

    user = settings.smtp_username.strip()
    pwd = settings.smtp_password
    if not user or not pwd:
        logger.warning("SMTP kullanıcı adı veya şifre boş; e-posta gönderilmedi.")
        return False

    try:
        if settings.smtp_use_tls:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as smtp:
                smtp.starttls()
                smtp.login(user, pwd)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port) as smtp:
                smtp.login(user, pwd)
                smtp.send_message(msg)
        logger.info("Şifre sıfırlama e-postası gönderildi: %s", to_email)
        return True
    except Exception as e:
        logger.exception("Şifre sıfırlama e-postası gönderilemedi (%s): %s", to_email, e)
        return False


def send_verification_email(
    to_email: str,
    display_name: str,
    verification_token: str,
    registration_type: str = "employee",
) -> bool:
    """Bekleyen başvuru: e-posta doğrulama bağlantısı (frontend /verify-email)."""
    base = settings.frontend_url.rstrip("/")
    verify_url = f"{base}/verify-email?token={verification_token}&type={registration_type}"

    from_addr = (settings.mail_from_address or settings.smtp_username).strip()
    if not from_addr:
        logger.warning("Doğrulama e-postası gönderilemedi: From adresi boş.")
        return False

    msg = EmailMessage()
    msg["Subject"] = f"{settings.app_name} — Verify your email"
    msg["From"] = (
        f"{settings.smtp_from_name} <{from_addr}>"
        if settings.smtp_from_name
        else from_addr
    )
    msg["To"] = to_email

    msg.set_content(
        f"Hello {display_name},\n\n"
        f"Complete your account application by opening this link:\n{verify_url}\n\n"
        f"If you did not start this application, you can ignore this email.\n"
    )

    msg.add_alternative(
        f"""\
<html>
  <body>
    <p>Hello {display_name},</p>
    <p>Complete your account application using the button below.</p>
    <p>
      <a href="{verify_url}" style="background:#0d9488;color:white;padding:10px 20px;
         text-decoration:none;border-radius:8px;display:inline-block;">
        Verify email
      </a>
    </p>
  </body>
</html>
""",
        subtype="html",
    )

    user = settings.smtp_username.strip()
    pwd = settings.smtp_password
    if not user or not pwd:
        logger.warning("SMTP kullanıcı adı veya şifre boş; doğrulama e-postası gönderilmedi.")
        return False

    try:
        if settings.smtp_use_tls:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as smtp:
                smtp.starttls()
                smtp.login(user, pwd)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port) as smtp:
                smtp.login(user, pwd)
                smtp.send_message(msg)
        logger.info("Doğrulama e-postası gönderildi: %s", to_email)
        return True
    except Exception as e:
        logger.exception("Doğrulama e-postası gönderilemedi (%s): %s", to_email, e)
        return False


def send_verification_email_task(
    to_email: str,
    display_name: str,
    verification_token: str,
    registration_type: str,
) -> None:
    send_verification_email(to_email, display_name, verification_token, registration_type)
