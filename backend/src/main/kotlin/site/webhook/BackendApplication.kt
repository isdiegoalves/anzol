package site.webhook

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.properties.ConfigurationPropertiesScan
import org.springframework.boot.runApplication

@SpringBootApplication
@ConfigurationPropertiesScan
class BackendApplication

fun main(args: Array<String>) {
    @Suppress("SpreadOperator")
    runApplication<BackendApplication>(*args)
}
