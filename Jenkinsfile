pipeline {
    agent any

    environment {
        APP_NAME = 'luckydraw-app'
        APP_PORT = '3001'
        ENV_FILE = '/var/jenkins_home/luckydraw.env'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build Docker Image') {
            steps {
                sh "docker build -t ${APP_NAME}:latest ."
            }
        }

        stage('Deploy') {
            steps {
                sh """
                    # 기존 컨테이너 중지 및 제거
                    docker stop ${APP_NAME} || true
                    docker rm ${APP_NAME} || true

                    # 새 컨테이너 실행
                    docker run -d \
                        --name ${APP_NAME} \
                        --restart always \
                        -p ${APP_PORT}:3000 \
                        --add-host=host.docker.internal:host-gateway \
                        --env-file ${ENV_FILE} \
                        ${APP_NAME}:latest
                """
            }
        }

        stage('Health Check') {
            steps {
                sh """
                    sleep 5
                    CONTAINER_IP=\$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${APP_NAME})
                    STATUS=\$(curl -s -o /dev/null -w '%{http_code}' http://\${CONTAINER_IP}:3000/)
                    if [ "\$STATUS" != "200" ]; then
                        echo "Health check failed: HTTP \$STATUS (IP: \$CONTAINER_IP)"
                        docker logs ${APP_NAME} --tail 20
                        exit 1
                    fi
                    echo "Health check passed: HTTP \$STATUS"
                """
            }
        }

        stage('Cleanup') {
            steps {
                sh 'docker image prune -f || true'
            }
        }
    }

    post {
        failure {
            sh "docker logs ${APP_NAME} --tail 50 || true"
        }
        success {
            echo "배포 완료: http://133.186.213.46:${APP_PORT}"
        }
    }
}
