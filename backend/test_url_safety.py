"""Tests for SSRF allowlist used by media proxy."""
import unittest

from backend.services.url_safety import is_safe_proxy_target


class UrlSafetyTests(unittest.TestCase):
    def test_ozon_host_allowed(self):
        self.assertTrue(
            is_safe_proxy_target("https://cdn1.ozone.ru/s3/multimedia-1/abc.jpg")
        )

    def test_localhost_rejected(self):
        self.assertFalse(is_safe_proxy_target("http://127.0.0.1:8080/internal"))

    def test_private_ip_rejected(self):
        self.assertFalse(is_safe_proxy_target("http://192.168.1.1/img.png"))

    def test_random_domain_rejected(self):
        self.assertFalse(is_safe_proxy_target("https://evil.example.com/p.png"))


if __name__ == "__main__":
    unittest.main()
