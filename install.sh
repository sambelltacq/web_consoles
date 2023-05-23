#!/bin/bash

mkdir -p links

echo "Installing handler"
install_dir=$(pwd)
default_location='/root/web_consoles'
if [ $install_dir != $default_location ]; then
    sed -i -r "s#^(install_dir=).*#\1$install_dir#" handle_serial_event
fi
chmod 755 handle_serial_event
cp handle_serial_event /usr/local/bin/

echo "Installing rules"
chmod 755 99-serial_console.rules
cp 99-serial_console.rules /etc/udev/rules.d/

echo "Installing Misc"
chmod 755 .screenrc
cp .screenrc ~/

echo "Installing packages"
apt-get install -y nodejs at screen

echo "Installing node modules"
npm install node-pty ws find-my-way

echo "Installing service"
sed -i -r "s#^(WorkingDirectory=).*#\1$install_dir#" web_consoles.service
sed -i -r "s#^(ExecStart=).*#\1${install_dir}/web_consoles.js#" web_consoles.service
cp web_consoles.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable web_consoles
systemctl start web_consoles