from setuptools import setup, find_packages

setup(
    name="chronos_sdk",
    version="0.1.0",
    description="The Transparent Interceptor SDK for Project Chronos",
    author="Project Chronos Architect",
    packages=find_packages(),  # Automatically finds 'chronos' package
    python_requires=">=3.8",
    install_requires=[
        # The interceptor relies only on standard library (threading, queue, json, etc.)
        # If specific versions of requests/openai were wrapped tightly, we'd list them,
        # but the interceptor is designed to be a lightweight wrapper.
    ],
)