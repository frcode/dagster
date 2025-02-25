from setuptools import find_packages, setup

setup(
    name="bollinger",
    version="dev",
    packages=find_packages(),
    install_requires=[
        "dagster",
        "dagster-pandera",
        "jupyterlab",
        "matplotlib",
        "seaborn",
        "pandera",
        "pandas",
    ],
)
