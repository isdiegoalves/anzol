plugins {
    kotlin("jvm") version "2.4.20"
    kotlin("plugin.serialization") version "2.4.20"
    application
    id("org.jlleitschuh.gradle.ktlint") version "14.2.0"
    id("dev.detekt") version "2.0.0-alpha.6"
}

group = "anzol"
version = "0.0.1-SNAPSHOT"

// Constrói com o JDK 25 e roda em Java 21 (o LTS das máquinas de dev e de CI): classes no formato do 21 e, com o
// -Xjdk-release, só a API do JDK 21 à vista do compilador (usar algo do 22 em diante não compila).
val runtimeJavaVersion = 21

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

kotlin {
    compilerOptions {
        jvmTarget =
            org.jetbrains.kotlin.gradle.dsl.JvmTarget
                .fromTarget(runtimeJavaVersion.toString())
        freeCompilerArgs.add("-Xjdk-release=$runtimeJavaVersion")
    }
}

tasks.withType<JavaCompile> {
    options.release = runtimeJavaVersion
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("com.github.ajalt.clikt:clikt-core:5.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    testImplementation(platform("org.junit:junit-bom:6.0.3"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation("org.assertj:assertj-core:3.27.7")
    testImplementation("org.awaitility:awaitility:4.3.0")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

application {
    applicationName = "anzol"
    mainClass = "anzol.cli.MainKt"
}

// -PtestJavaVersion=21 roda os testes (e o CLI que eles disparam como processo) nesse Java; sem a propriedade, no do
// toolchain. É como o CI confere que o CLI roda de fato no Java 21.
val testJavaVersion = providers.gradleProperty("testJavaVersion").map(String::toInt)

tasks.withType<Test> {
    useJUnitPlatform()
    if (testJavaVersion.isPresent) {
        javaLauncher = javaToolchains.launcherFor { languageVersion = JavaLanguageVersion.of(testJavaVersion.get()) }
    }
}

ktlint {
    version = "1.8.0"
}

detekt {
    buildUponDefaultConfig = true
    config.setFrom(files("config/detekt.yml"))
}

// Regras como UnsafeCallOnNullableType e NestedScopeFunctions só rodam com resolução de tipos.
tasks.check {
    dependsOn("detektMain", "detektTest")
}
